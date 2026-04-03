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

const pickColumn = (preferred: string[], fallback: string[]) => {
  for (const name of preferred) {
    if (fallback.includes(name)) return name;
  }
  return fallback[0];
};

const buildTemplate = (): ChartConfig[] => {
  const primaryNum = pickColumn(
    ["Weekly_Sales", "Revenue", "Amount", "Total"],
    demoColumns.numeric
  );
  const secondaryNum = demoColumns.numeric.find((col) => col !== primaryNum);
  const primaryCat = pickColumn(
    ["Store", "Department", "Category", "IsHoliday"],
    demoColumns.categorical
  );
  const secondaryCat = demoColumns.categorical.find((col) => col !== primaryCat);

  const configs: ChartConfig[] = [
    {
      id: makeId(),
      title: `Distribution of ${primaryNum}`,
      type: "histogram",
      x: primaryNum,
    },
    {
      id: makeId(),
      title: `Count by ${primaryCat}`,
      type: "bar",
      x: primaryCat,
    },
    {
      id: makeId(),
      title: `Average ${primaryNum} by ${primaryCat}`,
      type: "bar",
      x: primaryCat,
      y: primaryNum,
      agg: "mean",
    },
  ];

  if (secondaryCat) {
    configs.push({
      id: makeId(),
      title: `${primaryNum} spread by ${secondaryCat}`,
      type: "box",
      x: secondaryCat,
      y: primaryNum,
    });
  }

  if (secondaryNum) {
    configs.push({
      id: makeId(),
      title: `${primaryNum} vs ${secondaryNum}`,
      type: "scatter",
      x: secondaryNum,
      y: primaryNum,
    });
  }

  configs.push({
    id: makeId(),
    title: `Composition by ${primaryCat}`,
    type: "pie",
    x: primaryCat,
  });

  if (secondaryCat) {
    configs.push({
      id: makeId(),
      title: `${primaryCat} → ${secondaryCat}`,
      type: "sunburst",
      x: primaryCat,
      color: secondaryCat,
    });
  }

  return configs.slice(0, 8);
};

const requiresY: ChartType[] = ["line", "scatter", "box"];

export default function TemplateDashboardView() {
  const [charts, setCharts] = useState<ChartConfig[]>(() => buildTemplate());
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const filterColumns = useMemo(() => demoColumns.categorical.slice(0, 3), []);

  const updateChart = (id: string, next: Partial<ChartConfig>) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, ...next } : chart)));
  };

  const validationMessage = (chart: ChartConfig) => {
    if (!chart.x) return "Select an X axis to render this chart.";
    if (requiresY.includes(chart.type) && !chart.y) return "This chart requires a numeric Y axis.";
    if (chart.y && !demoColumns.numeric.includes(chart.y)) {
      return "Y must be a numeric column.";
    }
    return "";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-slate-900">
          Template Dashboard
        </div>
        <div className="text-sm text-slate-500">
          A curated layout you can tweak chart by chart with smart fallbacks.
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-500">
              GLOBAL FILTERS
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
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
          <button
            onClick={() => setCharts(buildTemplate())}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Reset Template
          </button>
        </div>
      </div>

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
                <div className="text-xs text-slate-500">Editable template chart</div>
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
                    {[
                      "bar",
                      "line",
                      "scatter",
                      "box",
                      "histogram",
                      "pie",
                      "sunburst",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {type}
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
                    {["mean", "median", "sum", "count"].map((agg) => (
                      <option key={agg} value={agg}>
                        {agg}
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
                  Template chart preview will render here once wired to data.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
