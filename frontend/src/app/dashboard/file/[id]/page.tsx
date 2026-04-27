"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import Plot from "@/components/PlotNoTypes";
import FilterPanel from "./FilterPanel";
import ChatPanel from "./ChatPanel";
import HealthDiagnosticView, { HealthSummaryForChat } from "./HealthDiagnosticView";
import DashboardBuilder from "./DashboardBuilder";

const SHOW_OVERVIEW_FILTERS = false;

type InsightsResponse = {
  kpis: Record<string, unknown>;
  charts: Record<string, { data: unknown[]; layout?: Record<string, unknown> }>;
  filters: Record<string, string[]>;
  ai_summary?: string | null;
};

type WorkbookMeta = {
  sheet_names: string[];
  sheet_count: number;
  default_sheet: string;
};

type FileMeta = {
  id: string;
  original_name: string;
  uploaded_at: string;
  size_bytes: number | null;
  status: string;
  workbook?: WorkbookMeta | null;
};

type FiltersState = Record<string, string | null>;
type TabId = "overview" | "health" | "explore";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function formatChartName(key: string): string {
  return key
    .replace(/^timeseries_/, "Trend Over Time - ")
    .replace(/^(distribution|breakdown)_\d+_/, (_, type) =>
      type === "distribution" ? "Distribution - " : "Breakdown - "
    )
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Chart narrative helpers
// ---------------------------------------------------------------------------

async function streamSSE(
  url: string,
  body: unknown,
  token: string,
  onToken: (text: string) => void,
  onError: (msg: string) => void,
  onDone: () => void,
  signal: AbortSignal,
) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) { onError("Request failed"); onDone(); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "token") onToken(evt.content);
            else if (evt.type === "error") onError(evt.content);
            else if (evt.type === "done") onDone();
          } catch { /* ignore malformed */ }
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error).name !== "AbortError") onError("Could not reach the AI. Please try again.");
    onDone();
  }
}

type PlotTrace = Record<string, unknown>;

function extractDataSummary(fig: { data: unknown[]; layout?: Record<string, unknown> }): string {
  if (!fig.data?.length) return "";
  const trace = fig.data[0] as PlotTrace;
  const type = String(trace.type ?? "");
  const lines: string[] = [];

  if (type === "pie") {
    const labels = (trace.labels as string[]) ?? [];
    const values = (trace.values as number[]) ?? [];
    const total = values.reduce((a, b) => a + b, 0);
    lines.push(`Total: ${total.toLocaleString()}`);
    labels
      .map((l, i) => ({ l, v: values[i] ?? 0 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 8)
      .forEach(({ l, v }) => {
        const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
        lines.push(`  ${l}: ${v.toLocaleString()} (${pct}%)`);
      });
  } else {
    const x = (trace.x as unknown[]) ?? [];
    const y = (trace.y as number[]) ?? [];
    const numY = y.filter((v) => typeof v === "number");
    if (numY.length) {
      const total = numY.reduce((a, b) => a + b, 0);
      const min = Math.min(...numY);
      const max = Math.max(...numY);
      lines.push(`Total: ${total.toLocaleString()}, Min: ${min.toLocaleString()}, Max: ${max.toLocaleString()}`);
      x.map((xi, i) => ({ xi: String(xi), yi: y[i] ?? 0 }))
        .sort((a, b) => b.yi - a.yi)
        .slice(0, 10)
        .forEach(({ xi, yi }) => lines.push(`  ${xi}: ${yi.toLocaleString()}`));
    } else if (x.length) {
      const nums = x.filter((v) => typeof v === "number") as number[];
      if (nums.length) {
        const sorted = [...nums].sort((a, b) => a - b);
        const mean = (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2);
        const median = sorted[Math.floor(sorted.length / 2)];
        lines.push(`Count: ${nums.length}, Min: ${sorted[0].toLocaleString()}, Max: ${sorted[sorted.length - 1].toLocaleString()}`);
        lines.push(`Mean: ${mean}, Median: ${median.toLocaleString()}`);
      }
    }
  }

  return lines.join("\n");
}

function inferChartTypeFromKey(key: string): string {
  if (key.startsWith("timeseries_")) return "line";
  if (key.startsWith("distribution_")) return "histogram";
  if (key.startsWith("breakdown_")) return "bar";
  return "bar";
}

function OverviewChartCard({
  chartKey,
  fig,
  fileId,
  token,
  plotTheme,
}: {
  chartKey: string;
  fig: { data: unknown[]; layout?: Record<string, unknown> };
  fileId: string;
  token: string;
  plotTheme: { fontColor: string; gridColor: string };
}) {
  const [narrateState, setNarrateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [narrative, setNarrative] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const title = formatChartName(chartKey);
  const chartType = inferChartTypeFromKey(chartKey);

  function handleNarrate() {
    if (narrateState === "loading") return;
    setNarrative("");
    setNarrateState("loading");

    const controller = new AbortController();
    abortRef.current = controller;

    streamSSE(
      `${API_BASE_URL}/api/files/${fileId}/chart-narrative`,
      { chart_title: title, chart_type: chartType, data_summary: extractDataSummary(fig) },
      token,
      (text) => setNarrative((prev) => prev + text),
      (msg) => { setNarrative(msg); setNarrateState("error"); },
      () => setNarrateState((s) => s !== "error" ? "done" : "error"),
      controller.signal,
    );
  }

  function handleDismiss() {
    abortRef.current?.abort();
    setNarrateState("idle");
    setNarrative("");
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-main)]">{title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          {narrateState === "idle" && (
            <button
              type="button"
              onClick={handleNarrate}
              className="text-xs text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 hover:border-cyan-400/60 rounded-lg px-2.5 py-1 transition-colors"
            >
              ✦ Narrate
            </button>
          )}
          {narrateState === "loading" && (
            <span className="text-xs text-[var(--text-muted)] animate-pulse">Analysing…</span>
          )}
          {(narrateState === "done" || narrateState === "error") && (
            <button
              type="button"
              onClick={narrateState === "done" ? handleNarrate : handleDismiss}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              {narrateState === "done" ? "Refresh" : "Dismiss"}
            </button>
          )}
          {narrateState === "done" && (
            <button
              type="button"
              onClick={handleDismiss}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              Hide
            </button>
          )}
        </div>
      </div>

      <div className="h-[340px] w-full">
        <Plot
          data={fig.data}
          layout={{
            ...(fig.layout || {}),
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: { ...(fig.layout?.font || {}), color: plotTheme.fontColor },
            xaxis: {
              ...(fig.layout?.xaxis || {}),
              gridcolor: plotTheme.gridColor,
              zerolinecolor: plotTheme.gridColor,
            },
            yaxis: {
              ...(fig.layout?.yaxis || {}),
              gridcolor: plotTheme.gridColor,
              zerolinecolor: plotTheme.gridColor,
            },
          }}
          config={{
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["toImage", "lasso2d", "select2d"],
          }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      {narrateState !== "idle" && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 text-sm leading-relaxed ${
          narrateState === "error"
            ? "border-red-500/30 bg-red-950/20 text-red-300"
            : "border-cyan-500/20 bg-cyan-950/20 text-[var(--text-main)]"
        }`}>
          <p className="text-xs font-semibold text-cyan-400 mb-1">✦ AI Narrative</p>
          {narrateState === "loading" && !narrative && (
            <span className="inline-flex gap-1 items-center h-4">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </span>
          )}
          {narrative && <span className="whitespace-pre-wrap">{narrative}</span>}
        </div>
      )}
    </div>
  );
}

export default function FileInsightsPage() {
  const params = useParams<{ id: string }>();
  const fileId = params.id;
  const { tokens } = useAuth();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [healthContext, setHealthContext] = useState<HealthSummaryForChat | null>(null);

  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [filtersState, setFiltersState] = useState<FiltersState>({});
  const [pendingFilters, setPendingFilters] = useState<FiltersState>({});
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const hasToken = !!tokens?.accessToken;

  useEffect(() => {
    if (!hasToken || !fileId) return;

    fetch(`${API_BASE_URL}/api/files/${fileId}`, {
      headers: { Authorization: `Bearer ${tokens!.accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const nextMeta = data as FileMeta;
        setFileMeta(nextMeta);
        setSelectedSheet((prev) => prev ?? nextMeta.workbook?.default_sheet ?? null);
      })
      .catch(() => {});
  }, [hasToken, fileId, tokens]);

  const plotTheme = useMemo(() => {
    if (typeof document === "undefined") {
      return { fontColor: "#e2e8f0", gridColor: "rgba(226, 232, 240, 0.12)" };
    }

    const styles = getComputedStyle(document.documentElement);
    const textMain = styles.getPropertyValue("--text-main").trim() || "#e2e8f0";
    return {
      fontColor: textMain,
      gridColor: theme === "dark"
        ? "rgba(226, 232, 240, 0.12)"
        : "rgba(15, 23, 42, 0.12)",
    };
  }, [theme]);

  const fetchInsightsWithFilters = useCallback(
    async (nextFilters: FiltersState) => {
      if (!hasToken || !fileId) return;

      try {
        setLoadingInsights(true);
        setInsightsError(null);

        const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/insights`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens!.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filters: nextFilters,
            sheet_name: selectedSheet,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Failed to load file overview");
        }

        setInsights((await res.json()) as InsightsResponse);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load file overview";
        setInsightsError(message);
      } finally {
        setLoadingInsights(false);
      }
    },
    [hasToken, fileId, selectedSheet, tokens]
  );

  const fetchInsights = useCallback(
    () => fetchInsightsWithFilters(filtersState),
    [fetchInsightsWithFilters, filtersState]
  );

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  useEffect(() => {
    const t = setTimeout(() => setFiltersState(pendingFilters), 500);
    return () => clearTimeout(t);
  }, [pendingFilters]);

  if (!hasToken) {
    return (
      <div className="px-6 py-6 text-sm text-red-400">
        You must be signed in to view this page.
      </div>
    );
  }

  const { kpis, charts, filters } = insights ?? {
    kpis: null,
    charts: null,
    filters: {},
  };
  const anyFilters = Object.keys(filters ?? {}).length > 0;
  const showOverviewFilters = SHOW_OVERVIEW_FILTERS && anyFilters;
  const workbook = fileMeta?.workbook ?? null;
  const hasWorkbookSheets = !!workbook && workbook.sheet_count > 0;

  const handleFilterChange = (key: string, value: string | null) =>
    setPendingFilters((prev) => ({ ...prev, [key]: value === "" ? null : value }));

  const clearAll = () => {
    setPendingFilters({});
    setFiltersState({});
    fetchInsightsWithFilters({});
  };

  const fileTitle = fileMeta?.original_name ?? "File Analysis";
  const fileSubtitle = fileMeta
    ? [
        `Uploaded ${new Date(fileMeta.uploaded_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
        formatFileSize(fileMeta.size_bytes),
        selectedSheet ? `Sheet: ${selectedSheet}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const tabs: { id: TabId; label: string; badge?: string }[] = [
    { id: "overview", label: "File Overview" },
    { id: "health", label: "Data Health", badge: "Recommended" },
    { id: "explore", label: "Charts" },
  ];

  return (
    <div className="flex w-full min-h-screen">
      {activeTab === "overview" && showOverviewFilters && (
        <aside className="hidden lg:flex flex-col w-64 border-r border-[var(--border)] bg-[color:var(--bg-panel)] p-4 overflow-y-auto">
          <FilterPanel
            filters={filters ?? {}}
            selected={pendingFilters}
            onChange={handleFilterChange}
            onClear={clearAll}
            onApply={() => {
              setFiltersState(pendingFilters);
              fetchInsightsWithFilters(pendingFilters);
            }}
          />
        </aside>
      )}

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[var(--text-main)] truncate">
              {fileTitle}
            </h1>
            {fileSubtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{fileSubtitle}</p>
            )}
          </div>

          {activeTab === "overview" && (
            <div className="flex items-center gap-2">
              {hasWorkbookSheets && (
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>Sheet</span>
                  <select
                    value={selectedSheet ?? workbook?.default_sheet ?? ""}
                    onChange={(e) => {
                      setPendingFilters({});
                      setFiltersState({});
                      setSelectedSheet(e.target.value || null);
                    }}
                    className="rounded-md border border-[var(--border)] bg-[color:var(--bg-panel)] px-2 py-1.5 text-xs text-[var(--text-main)]"
                  >
                    {(workbook?.sheet_names ?? []).map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button
                onClick={fetchInsights}
                disabled={loadingInsights}
                className="shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-main)] hover:bg-[color:var(--bg-panel-2)] disabled:opacity-60"
                type="button"
              >
                {loadingInsights ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          )}
        </header>

        <div className="flex gap-1 border-b border-[var(--border)]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              className={[
                "relative px-4 py-2 text-sm font-medium rounded-t-md transition-colors",
                activeTab === tab.id
                  ? "bg-[color:var(--bg-panel)] text-[var(--text-main)] border border-b-0 border-[var(--border)] -mb-px"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]",
              ].join(" ")}
            >
              {tab.label}
              {tab.badge && activeTab !== tab.id && (
                <span className="ml-2 inline-block rounded-full bg-cyan-500/20 border border-cyan-500/40 px-1.5 py-0 text-xs font-semibold text-cyan-300 leading-4">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <>
            {loadingInsights && !insights && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                Loading your file...
              </div>
            )}

            {insightsError && (
              <div className="rounded-md border border-red-700 bg-red-900/20 px-4 py-2 text-sm text-red-300">
                {insightsError}
              </div>
            )}

            {kpis && Object.keys(kpis).length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-[var(--text-main)]">
                  Key Metrics
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(kpis).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-4"
                    >
                      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
                      <p className="mt-2 text-2xl font-semibold text-cyan-300">
                        {typeof value === "number" ? value.toLocaleString() : String(value)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {charts && Object.keys(charts).length > 0 && (
              <section className="space-y-6">
                <h2 className="text-sm font-semibold text-[var(--text-main)]">Charts</h2>
                {Object.entries(charts).map(([key, fig]) => (
                  <OverviewChartCard
                    key={key}
                    chartKey={key}
                    fig={fig}
                    fileId={fileId}
                    token={tokens!.accessToken ?? ""}
                    plotTheme={plotTheme}
                  />
                ))}
              </section>
            )}

            {!loadingInsights && !insightsError && !insights && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                No data available.
              </div>
            )}
          </>
        )}

        {activeTab === "health" && (
          <HealthDiagnosticView
            fileId={fileId}
            fileName={fileTitle}
            token={tokens!.accessToken ?? ""}
            sheetName={selectedSheet}
            onHealthLoaded={setHealthContext}
          />
        )}

        {activeTab === "explore" && (
          <DashboardBuilder
            fileId={fileId}
            token={tokens!.accessToken ?? ""}
            sheetName={selectedSheet}
            onSheetChange={setSelectedSheet}
          />
        )}
      </main>

      <ChatPanel
        fileId={fileId}
        token={tokens!.accessToken ?? ""}
        currentTab={activeTab}
        sheetName={selectedSheet}
        healthContext={healthContext}
        initialSummary={insights?.ai_summary ?? null}
      />
    </div>
  );
}
