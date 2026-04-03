import { useMemo, useState } from "react";

type ChartType = "bar" | "line" | "scatter" | "box" | "histogram" | "pie" | "sunburst";
type Aggregation = "mean" | "median" | "sum" | "count";

type ChartConfig = {
  id: string;
  title: string;
  type: ChartType;
  x?: string;
  y?: string;
  color?: string;
  agg?: Aggregation;
};

const chartTypes: { label: string; value: ChartType; requiresY: boolean }[] = [
  { label: "Bar", value: "bar", requiresY: false },
  { label: "Line", value: "line", requiresY: true },
  { label: "Scatter", value: "scatter", requiresY: true },
  { label: "Box", value: "box", requiresY: true },
  { label: "Histogram", value: "histogram", requiresY: false },
  { label: "Pie", value: "pie", requiresY: false },
  { label: "Sunburst", value: "sunburst", requiresY: false },
];

const aggOptions: { label: string; value: Aggregation }[] = [
  { label: "Mean", value: "mean" },
  { label: "Median", value: "median" },
  { label: "Sum", value: "sum" },
  { label: "Count", value: "count" },
];

const demoColumns = {
  all: [
    "Store",
    "Department",
    "Weekly_Sales",
    "IsHoliday",
    "Temperature",
    "Fuel_Price",
    "CPI",
    "Unemployment",
    "Date",
  ],
  numeric: ["Weekly_Sales", "Temperature", "Fuel_Price", "CPI", "Unemployment"],
  categorical: ["Store", "Department", "IsHoliday"],
};

const makeId = () => Math.random().toString(36).slice(2);

export default function BuildDashboardView() {
  const [charts, setCharts] = useState<ChartConfig[]>([]);
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  const filterColumns = useMemo(() => demoColumns.categorical.slice(0, 3), []);

  const addChart = () => {
    setCharts((prev) => [
      ...prev,
      {
        id: makeId(),
        title: "Untitled Chart",
        type: "bar",
        x: demoColumns.categorical[0],
        y: demoColumns.numeric[0],
        agg: "mean",
      },
    ]);
  };

  const updateChart = (id: string, next: Partial<ChartConfig>) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, ...next } : chart)));
  };

  const removeChart = (id: string) => {
    setCharts((prev) => prev.filter((chart) => chart.id !== id));
  };

  const validationMessage = (chart: ChartConfig) => {
    const typeConfig = chartTypes.find((t) => t.value === chart.type);
    if (!chart.x) return "Select an X axis to render this chart.";
    if (typeConfig?.requiresY && !chart.y) return "This chart requires a numeric Y axis.";
    if (chart.y && !demoColumns.numeric.includes(chart.y)) {
      return "Y must be a numeric column.";
    }
    return "";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-slate-900">
          Build Your Own Dashboard
        </div>
        <div className="text-sm text-slate-500">
          Configure multiple charts with consistent styling and guardrails.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold tracking-wide text-slate-500">
          GLOBAL FILTERS
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {filterColumns.map((col) => (
            <label key={col} className="flex flex-col gap-2 text-xs text-slate-600">
              {col}
              <select
                multiple
                value={filters[col] || []}
                onChange={(event) => {
                  const values = Array.from(event.target.selectedOptions).map(
                    (option) => option.value
                  );
                  setFilters((prev) => ({ ...prev, [col]: values }));
                }}
                className="min-w-[180px] rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
              >
                {demoColumns.categorical.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-500">
          {charts.length} chart{charts.length === 1 ? "" : "s"} configured
        </div>
        <button
          onClick={addChart}
          className="rounded-lg bg-[#00A3E0] px-4 py-2 text-sm font-semibold text-white"
        >
          Add Chart
        </button>
      </div>

      {charts.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
          Add a chart to start building a custom dashboard.
        </div>
      )}

      <div className="space-y-6">
        {charts.map((chart) => {
          const warning = validationMessage(chart);
          return (
            <div key={chart.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  value={chart.title}
                  onChange={(event) => updateChart(chart.id, { title: event.target.value })}
                  className="w-full max-w-[320px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900"
                />
                <button
                  onClick={() => removeChart(chart.id)}
                  className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600"
                >
                  Remove
                </button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-5">
                <label className="text-xs text-slate-500">
                  Chart Type
                  <select
                    value={chart.type}
                    onChange={(event) =>
                      updateChart(chart.id, { type: event.target.value as ChartType })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
                  >
                    {chartTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  X Axis
                  <select
                    value={chart.x || ""}
                    onChange={(event) => updateChart(chart.id, { x: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
                  >
                    <option value="">Select</option>
                    {demoColumns.all.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Y Axis
                  <select
                    value={chart.y || ""}
                    onChange={(event) => updateChart(chart.id, { y: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
                    disabled={!demoColumns.numeric.length}
                  >
                    <option value="">Select</option>
                    {demoColumns.numeric.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Aggregation
                  <select
                    value={chart.agg || "mean"}
                    onChange={(event) =>
                      updateChart(chart.id, { agg: event.target.value as Aggregation })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
                  >
                    {aggOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Color / Group
                  <select
                    value={chart.color || ""}
                    onChange={(event) => updateChart(chart.id, { color: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-700"
                  >
                    <option value="">None</option>
                    {demoColumns.all.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {warning ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                  {warning}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-400">
                  Chart preview will render here once wired to data.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
