"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import Plot from "@/components/PlotNoTypes";
import FilterPanel from "./FilterPanel";
import AIWidget from "./AIWidget";
import HealthDiagnosticView from "./HealthDiagnosticView";

type InsightsResponse = {
  kpis: Record<string, any>;
  charts: Record<string, any>;
  filters: Record<string, string[]>;
  ai_summary?: string | null;
};

type FiltersState = Record<string, string | null>;
type TabId = "overview" | "health";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Human-readable chart title: strip the numeric prefix and snake_case
function formatChartName(key: string): string {
  // e.g. "missing_data_by_field" → "Missing Data by Field"
  // e.g. "distribution_1_Sales_Amount" → "Distribution of Sales Amount"
  return key
    .replace(/^(distribution|breakdown)_\d+_/, (_, type) =>
      type === "distribution" ? "Distribution — " : "Breakdown — "
    )
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function FileInsightsPage() {
  const params = useParams<{ id: string }>();
  const fileId = params.id;
  const { tokens } = useAuth();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [filtersState, setFiltersState] = useState<FiltersState>({});
  const [pendingFilters, setPendingFilters] = useState<FiltersState>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasToken = !!tokens?.accessToken;

  const plotTheme = useMemo(() => {
    if (typeof document === "undefined") {
      return { fontColor: "#e2e8f0", gridColor: "rgba(226, 232, 240, 0.12)" };
    }
    const styles = getComputedStyle(document.documentElement);
    const textMain = styles.getPropertyValue("--text-main").trim() || "#e2e8f0";
    const gridColor =
      theme === "dark"
        ? "rgba(226, 232, 240, 0.12)"
        : "rgba(15, 23, 42, 0.12)";
    return { fontColor: textMain, gridColor };
  }, [theme]);

  const fetchInsightsWithFilters = useCallback(
    async (nextFilters: FiltersState) => {
      if (!hasToken || !fileId) return;
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/insights`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens!.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ filters: nextFilters }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to load file overview (${res.status}): ${text || res.statusText}`);
        }
        const data = (await res.json()) as InsightsResponse;
        setInsights(data);
      } catch (err: any) {
        console.error("Insights error:", err);
        setError(err.message || "Failed to load file overview");
      } finally {
        setLoading(false);
      }
    },
    [hasToken, fileId, tokens]
  );

  const fetchInsights = useCallback(async () => {
    await fetchInsightsWithFilters(filtersState);
  }, [fetchInsightsWithFilters, filtersState]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  // Debounce pending filters → applied filters
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

  const { kpis, charts, filters } = insights ?? { kpis: null, charts: null, filters: {} };
  const anyFilters = Object.keys(filters ?? {}).length > 0;

  const handleFilterChange = (key: string, value: string | null) => {
    setPendingFilters((prev) => ({ ...prev, [key]: value === "" ? null : value }));
  };

  const clearAll = () => {
    setPendingFilters({});
    setFiltersState({});
    fetchInsightsWithFilters({});
  };

  const tabs: { id: TabId; label: string; description: string }[] = [
    {
      id: "overview",
      label: "File Overview",
      description: "Charts and key metrics from your data",
    },
    {
      id: "health",
      label: "Data Health",
      description: "Quality score, issues, and field-by-field breakdown",
    },
  ];

  return (
    <div className="flex w-full min-h-screen">
      {/* LEFT FILTER PANEL — only shown on overview tab */}
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
            onApplyPreset={(preset) => {
              console.log("Preset:", preset);
            }}
          />
        </aside>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {/* Page header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text-main)]">
              File Analysis
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)] font-mono">
              ID: <span className="text-cyan-300">{fileId}</span>
            </p>
          </div>

          {activeTab === "overview" && (
            <button
              onClick={fetchInsights}
              disabled={loading}
              className="rounded-md border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-main)] hover:bg-[color:var(--bg-panel-2)] disabled:opacity-60"
              type="button"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </header>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-[var(--border)] pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              className={[
                "px-4 py-2 text-sm font-medium rounded-t-md transition-colors",
                activeTab === tab.id
                  ? "bg-[color:var(--bg-panel)] text-[var(--text-main)] border border-b-0 border-[var(--border)] -mb-px"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: File Overview ── */}
        {activeTab === "overview" && (
          <>
            {/* Loading state */}
            {loading && !insights && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                Loading your file…
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="rounded-md border border-red-700 bg-red-900/20 px-4 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* KPI Cards */}
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
                        {typeof value === "number" ? value.toLocaleString() : value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Charts */}
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
                          font: {
                            ...(fig.layout?.font || {}),
                            color: plotTheme.fontColor,
                          },
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

            {/* No data yet */}
            {!loading && !error && !insights && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                No data available for this file.
              </div>
            )}
          </>
        )}

        {/* ── Tab: Data Health ── */}
        {activeTab === "health" && (
          <HealthDiagnosticView
            fileId={fileId}
            token={tokens!.accessToken ?? ""}
          />
        )}
      </main>

      {/* AI floating button — only on overview tab */}
      {activeTab === "overview" && (
        <AIWidget
          fileId={fileId}
          initialSummary={(insights as any)?.ai_summary ?? null}
          token={tokens!.accessToken ?? ""}
        />
      )}
    </div>
  );
}
