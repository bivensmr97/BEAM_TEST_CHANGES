"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import Plot from "@/components/PlotNoTypes";
import FilterPanel from "./FilterPanel";
import AIWidget from "./AIWidget";
import HealthDiagnosticView from "./HealthDiagnosticView";
import DashboardBuilder from "./DashboardBuilder";

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

export default function FileInsightsPage() {
  const params = useParams<{ id: string }>();
  const fileId = params.id;
  const { tokens } = useAuth();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

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
      {activeTab === "overview" && anyFilters && (
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
                <span className="ml-2 inline-block rounded-full bg-cyan-500/20 border border-cyan-500/40 px-1.5 py-0 text-[10px] font-semibold text-cyan-300 leading-4">
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
                  <div
                    key={key}
                    className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-5"
                  >
                    <h3 className="mb-3 text-sm font-semibold text-[var(--text-main)]">
                      {formatChartName(key)}
                    </h3>
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
                  </div>
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
          />
        )}

        {activeTab === "explore" && (
          <DashboardBuilder
            fileId={fileId}
            token={tokens!.accessToken ?? ""}
            sheetName={selectedSheet}
          />
        )}
      </main>

      {activeTab === "overview" && (
        <AIWidget
          fileId={fileId}
          initialSummary={insights?.ai_summary ?? null}
          token={tokens!.accessToken ?? ""}
          sheetName={selectedSheet}
        />
      )}
    </div>
  );
}
