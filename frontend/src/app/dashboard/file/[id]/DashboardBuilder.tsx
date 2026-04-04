"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "@/components/PlotNoTypes";
import { useTheme } from "@/context/ThemeContext";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

type ColType = "numeric" | "datetime" | "categorical";

type ColMeta = {
  name: string;
  inferred_type: ColType;
  null_rate: number;
  distinct_count: number;
};

type ChartType = "bar" | "line" | "scatter" | "histogram" | "box" | "pie";
type AggFunc = "count" | "sum" | "mean" | "median";

type ChartConfig = {
  id: string;
  title: string;
  chart_type: ChartType;
  x: string;
  y: string;
  agg: AggFunc;
  color_by: string;
};

// ── Chart type metadata ────────────────────────────────────────────────────────

type ChartMeta = {
  label: string;
  icon: string;
  hint: string;
  needsX: boolean;
  needsY: boolean;
  showAgg: boolean;
  showColorBy: boolean;
  xLabel: string;
  yLabel: string;
};

const CHART_META: Record<ChartType, ChartMeta> = {
  bar: {
    label: "Bar Chart",
    icon: "▊",
    hint: "Compare values across categories — great for totals, averages, or counts by group.",
    needsX: true,
    needsY: false,
    showAgg: true,
    showColorBy: true,
    xLabel: "Category (X)",
    yLabel: "Value (Y)",
  },
  line: {
    label: "Line Chart",
    icon: "📈",
    hint: "Show how a value changes over time or a sequence — ideal for trends.",
    needsX: true,
    needsY: true,
    showAgg: true,
    showColorBy: true,
    xLabel: "Time / Sequence (X)",
    yLabel: "Numeric Value (Y)",
  },
  scatter: {
    label: "Scatter Plot",
    icon: "⬤",
    hint: "Explore the relationship between two numeric fields — spot correlations and outliers.",
    needsX: true,
    needsY: true,
    showAgg: false,
    showColorBy: true,
    xLabel: "Numeric Field (X)",
    yLabel: "Numeric Field (Y)",
  },
  histogram: {
    label: "Histogram",
    icon: "▤",
    hint: "See how values are distributed across a numeric field — understand spread and shape.",
    needsX: true,
    needsY: false,
    showAgg: false,
    showColorBy: false,
    xLabel: "Numeric Field",
    yLabel: "",
  },
  box: {
    label: "Box Plot",
    icon: "▭",
    hint: "Show the spread, median, and outliers for a numeric field, optionally grouped.",
    needsX: false,
    needsY: true,
    showAgg: false,
    showColorBy: false,
    xLabel: "Group By (optional)",
    yLabel: "Numeric Field",
  },
  pie: {
    label: "Pie Chart",
    icon: "◔",
    hint: "Show how a total breaks down into proportions across categories.",
    needsX: true,
    needsY: false,
    showAgg: false,
    showColorBy: false,
    xLabel: "Category (slices)",
    yLabel: "Value (optional)",
  },
};

const CHART_TYPES = (Object.keys(CHART_META) as ChartType[]);

const AGG_OPTIONS: { label: string; value: AggFunc }[] = [
  { label: "Count records", value: "count" },
  { label: "Sum",           value: "sum" },
  { label: "Average",       value: "mean" },
  { label: "Median",        value: "median" },
];

const makeId = () => Math.random().toString(36).slice(2, 10);

// ── Validation ─────────────────────────────────────────────────────────────────

function validate(cfg: ChartConfig, numCols: string[]): string | null {
  const meta = CHART_META[cfg.chart_type];
  if (meta.needsX && !cfg.x) return `Select a field for "${meta.xLabel}"`;
  if (meta.needsY && !cfg.y) return `Select a field for "${meta.yLabel}"`;
  if (cfg.y && !numCols.includes(cfg.y))
    return "The Y axis field must be numeric";
  if (cfg.x && cfg.y && cfg.x === cfg.y)
    return "X and Y must be different fields";
  return null;
}

// ── Helper: friendly column name ───────────────────────────────────────────────

function friendly(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── ColSelect ─────────────────────────────────────────────────────────────────

function ColSelect({
  label,
  value,
  onChange,
  cols,
  placeholder = "Select field",
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  cols: ColMeta[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wide font-medium text-[var(--text-muted)]">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)] disabled:opacity-40 focus:outline-none focus:border-cyan-400"
      >
        <option value="">{placeholder}</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>
            {friendly(c.name)}
            {c.inferred_type === "numeric" ? " (#)" : c.inferred_type === "datetime" ? " (date)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── ChartCard ─────────────────────────────────────────────────────────────────

function ChartCard({
  cfg,
  cols,
  renderedFig,
  isRunning,
  onUpdate,
  onRemove,
  onRender,
  plotLayout,
}: {
  cfg: ChartConfig;
  cols: ColMeta[];
  renderedFig: any | null;
  isRunning: boolean;
  onUpdate: (patch: Partial<ChartConfig>) => void;
  onRemove: () => void;
  onRender: () => void;
  plotLayout: object;
}) {
  const meta = CHART_META[cfg.chart_type];
  const numCols = cols.filter((c) => c.inferred_type === "numeric");
  const catCols = cols.filter((c) => c.inferred_type === "categorical");
  const allCols = cols;

  // Column lists per role
  const xCols = cfg.chart_type === "scatter" ? numCols
    : cfg.chart_type === "histogram" ? numCols
    : cfg.chart_type === "pie" ? catCols.length ? catCols : allCols
    : allCols;
  const yCols = numCols;
  const colorCols = catCols;

  const validationError = validate(cfg, numCols.map((c) => c.name));
  const isReady = !validationError;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] overflow-hidden">
      {/* ── Card header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
        <span className="text-lg opacity-70">{meta.icon}</span>
        <input
          value={cfg.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          className="flex-1 bg-transparent text-sm font-semibold text-[var(--text-main)] focus:outline-none placeholder:text-[var(--text-muted)]"
          placeholder="Chart title…"
          maxLength={80}
        />
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRender}
            disabled={!isReady || isRunning}
            className="rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
          >
            {isRunning ? "Running…" : renderedFig ? "Re-render" : "Render"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[var(--text-muted)] hover:text-red-400 text-xs px-2 py-1.5 rounded transition-colors"
            title="Remove chart"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Config row ── */}
      <div className="px-4 py-3 bg-[color:var(--bg-main)] border-b border-[var(--border)]">
        {/* Chart type selector */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {CHART_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onUpdate({ chart_type: t, x: "", y: "", color_by: "" })}
              className={[
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
                cfg.chart_type === t
                  ? "bg-cyan-500/20 border-cyan-500/60 text-cyan-300"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--text-muted)]",
              ].join(" ")}
            >
              {CHART_META[t].icon} {CHART_META[t].label}
            </button>
          ))}
        </div>

        {/* Field config */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(meta.needsX || cfg.chart_type === "box") && (
            <ColSelect
              label={meta.xLabel || "X Axis"}
              value={cfg.x}
              onChange={(v) => onUpdate({ x: v })}
              cols={xCols}
              required={meta.needsX}
            />
          )}

          {(meta.needsY || meta.showAgg) && (
            <ColSelect
              label={meta.yLabel || "Y Axis (numeric)"}
              value={cfg.y}
              onChange={(v) => onUpdate({ y: v })}
              cols={yCols}
              placeholder="Select numeric field"
              required={meta.needsY}
            />
          )}

          {meta.showAgg && (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide font-medium text-[var(--text-muted)]">
                Aggregation
              </span>
              <select
                value={cfg.agg}
                onChange={(e) => onUpdate({ agg: e.target.value as AggFunc })}
                className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-main)] px-2 py-1.5 text-sm text-[var(--text-main)] focus:outline-none focus:border-cyan-400"
              >
                {AGG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          )}

          {meta.showColorBy && (
            <ColSelect
              label="Group / Colour by"
              value={cfg.color_by}
              onChange={(v) => onUpdate({ color_by: v })}
              cols={colorCols}
              placeholder="None"
            />
          )}
        </div>

        {/* Hint */}
        <p className="mt-2 text-[11px] text-[var(--text-muted)] leading-relaxed">
          {meta.hint}
        </p>
      </div>

      {/* ── Chart output area ── */}
      <div className="px-4 py-4">
        {validationError && !renderedFig && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {validationError}
          </div>
        )}

        {isRunning && (
          <div className="flex items-center justify-center py-10 text-sm text-[var(--text-muted)]">
            <span className="animate-pulse">Generating chart…</span>
          </div>
        )}

        {!isRunning && renderedFig && (
          <div className="h-[340px] w-full">
            <Plot
              data={renderedFig.data}
              layout={{
                ...(renderedFig.layout ?? {}),
                ...plotLayout,
                title: undefined,
              }}
              config={{
                responsive: true,
                displaylogo: false,
                modeBarButtonsToRemove: ["lasso2d", "select2d", "toImage"],
              }}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        )}

        {!isRunning && !renderedFig && isReady && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-[var(--text-muted)] border border-dashed border-[var(--border)] rounded-lg">
            <span className="text-2xl opacity-30">{meta.icon}</span>
            <p className="text-xs">Click <strong className="text-[var(--text-main)]">Render</strong> to generate this chart</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardBuilder({
  fileId,
  token,
}: {
  fileId: string;
  token: string;
}) {
  const { theme } = useTheme();

  // Column metadata from the file
  const [cols, setCols] = useState<ColMeta[]>([]);
  const [colsLoading, setColsLoading] = useState(true);
  const [colsError, setColsError] = useState<string | null>(null);

  // Chart configs and rendered results
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [rendered, setRendered] = useState<Record<string, any>>({});
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runError, setRunError] = useState<string | null>(null);

  const numCols = cols.filter((c) => c.inferred_type === "numeric");
  const catCols = cols.filter((c) => c.inferred_type === "categorical");

  // Consistent Plotly theming
  const plotLayout = useMemo(() => ({
    autosize: true,
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: {
      color: theme === "dark" ? "#e2e8f0" : "#0f172a",
      size: 12,
    },
    xaxis: {
      gridcolor: theme === "dark" ? "rgba(226,232,240,0.1)" : "rgba(15,23,42,0.08)",
      zerolinecolor: theme === "dark" ? "rgba(226,232,240,0.15)" : "rgba(15,23,42,0.12)",
    },
    yaxis: {
      gridcolor: theme === "dark" ? "rgba(226,232,240,0.1)" : "rgba(15,23,42,0.08)",
      zerolinecolor: theme === "dark" ? "rgba(226,232,240,0.15)" : "rgba(15,23,42,0.12)",
    },
    margin: { l: 50, r: 20, t: 20, b: 50 },
  }), [theme]);

  // ── Fetch column metadata ────────────────────────────────────────────────────
  useEffect(() => {
    if (!fileId || !token) return;
    setColsLoading(true);
    fetch(`${API_BASE_URL}/api/files/${fileId}/insights`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load file columns"))))
      .then((data) => {
        setCols(data.columns ?? []);
        setColsError(null);
      })
      .catch((err) => setColsError(err.message ?? "Failed to load columns"))
      .finally(() => setColsLoading(false));
  }, [fileId, token]);

  // ── Chart management ─────────────────────────────────────────────────────────
  const addChart = useCallback(() => {
    const defaultX = catCols[0]?.name ?? cols[0]?.name ?? "";
    const defaultY = numCols[0]?.name ?? "";
    setCharts((prev) => [
      ...prev,
      {
        id: makeId(),
        title: `Chart ${prev.length + 1}`,
        chart_type: "bar",
        x: defaultX,
        y: defaultY,
        agg: "count",
        color_by: "",
      },
    ]);
  }, [catCols, numCols, cols]);

  const updateChart = useCallback((id: string, patch: Partial<ChartConfig>) => {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    // Clear stale render when config changes
    setRendered((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const removeChart = useCallback((id: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== id));
    setRendered((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ── Render charts (one or all) ───────────────────────────────────────────────
  const renderCharts = useCallback(
    async (ids: string[]) => {
      const toRun = charts.filter((c) => ids.includes(c.id));
      if (!toRun.length) return;

      setRunError(null);
      setRunningIds((prev) => new Set([...prev, ...ids]));

      try {
        const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/custom-charts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ charts: toRun, filters: {} }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || "Failed to generate charts");
        }

        const data = await res.json();
        const newFigs: Record<string, any> = data.charts ?? {};

        setRendered((prev) => ({ ...prev, ...newFigs }));

        // Flag charts that returned no result
        const missing = toRun.filter((c) => !newFigs[c.id]);
        if (missing.length) {
          setRunError(
            `${missing.length} chart${missing.length > 1 ? "s" : ""} could not be rendered — check the field selections are compatible with the chart type.`
          );
        }
      } catch (err: any) {
        setRunError(err.message ?? "Chart generation failed. Please try again.");
      } finally {
        setRunningIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [charts, fileId, token]
  );

  const renderAll = useCallback(() => {
    const validIds = charts
      .filter((c) => !validate(c, numCols.map((n) => n.name)))
      .map((c) => c.id);
    renderCharts(validIds);
  }, [charts, numCols, renderCharts]);

  const anyRunning = runningIds.size > 0;
  const validChartCount = charts.filter(
    (c) => !validate(c, numCols.map((n) => n.name))
  ).length;

  // ── Loading / error state ────────────────────────────────────────────────────
  if (colsLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--text-muted)]">
        <span className="animate-pulse">Loading file columns…</span>
      </div>
    );
  }

  if (colsError) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-5 text-sm text-red-300">
        Could not load column information: {colsError}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-main)]">Explore Your Data</h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Build custom charts from{" "}
            <span className="text-[var(--text-main)] font-medium">{cols.length} fields</span>
            {numCols.length > 0 && (
              <> — {numCols.length} numeric, {catCols.length} categorical</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {charts.length > 0 && (
            <button
              type="button"
              onClick={renderAll}
              disabled={anyRunning || validChartCount === 0}
              className="rounded-md border border-cyan-500/50 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 text-cyan-300 text-sm font-medium px-4 py-2 transition-colors"
            >
              {anyRunning ? "Running…" : `▶  Render All (${validChartCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={addChart}
            disabled={cols.length === 0}
            className="rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 transition-colors"
          >
            + Add Chart
          </button>
        </div>
      </div>

      {/* ── Run error banner ── */}
      {runError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300 flex items-start justify-between gap-3">
          <span>{runError}</span>
          <button
            type="button"
            onClick={() => setRunError(null)}
            className="shrink-0 text-amber-400 hover:text-amber-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {charts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-16 gap-4 text-center">
          <div className="text-4xl opacity-20">📊</div>
          <div>
            <p className="text-sm font-medium text-[var(--text-main)]">No charts yet</p>
            <p className="mt-1 text-xs text-[var(--text-muted)] max-w-xs">
              Add a chart and choose which fields to plot. You can add as many as you need and render them all at once.
            </p>
          </div>
          <button
            type="button"
            onClick={addChart}
            className="rounded-md bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-semibold px-5 py-2 transition-colors"
          >
            + Add your first chart
          </button>

          {/* Column summary chips */}
          {cols.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 max-w-lg">
              {cols.slice(0, 12).map((c) => (
                <span
                  key={c.name}
                  className={[
                    "rounded-full px-2.5 py-0.5 text-[10px] font-medium border",
                    c.inferred_type === "numeric"
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                      : c.inferred_type === "datetime"
                      ? "bg-purple-500/10 border-purple-500/30 text-purple-300"
                      : "bg-slate-500/10 border-slate-500/30 text-[var(--text-muted)]",
                  ].join(" ")}
                >
                  {friendly(c.name)}
                </span>
              ))}
              {cols.length > 12 && (
                <span className="text-[10px] text-[var(--text-muted)] self-center">
                  +{cols.length - 12} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Chart cards ── */}
      <div className="space-y-5">
        {charts.map((cfg) => (
          <ChartCard
            key={cfg.id}
            cfg={cfg}
            cols={cols}
            renderedFig={rendered[cfg.id] ?? null}
            isRunning={runningIds.has(cfg.id)}
            onUpdate={(patch) => updateChart(cfg.id, patch)}
            onRemove={() => removeChart(cfg.id)}
            onRender={() => renderCharts([cfg.id])}
            plotLayout={plotLayout}
          />
        ))}
      </div>

      {/* ── Help footer ── */}
      {charts.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] px-4 py-3">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
            Field types in this file
          </p>
          <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1" />
              Numeric ({numCols.length}) — use for Y axis, scatter plots, histograms
            </span>
            <span>
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1" />
              Categorical ({catCols.length}) — use for X axis, grouping, pie slices
            </span>
            {cols.filter((c) => c.inferred_type === "datetime").length > 0 && (
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />
                Date/Time ({cols.filter((c) => c.inferred_type === "datetime").length}) — use for X axis on line charts
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
