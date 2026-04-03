import { useMemo, useState } from "react";

type Severity = "low" | "med" | "high";

type Finding = {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
};

type DiagnosticResult = {
  score: number;
  grade: string;
  rows: number;
  columns: number;
  missingRate: string;
  duplicateRate: string;
  findings: Finding[];
};

const demoResult: DiagnosticResult = {
  score: 86,
  grade: "B",
  rows: 18234,
  columns: 24,
  missingRate: "4.2%",
  duplicateRate: "1.3%",
  findings: [
    {
      id: "missingness",
      category: "Completeness",
      severity: "med",
      title: "Missing values detected",
      detail: "2 columns exceed 5% missingness.",
      recommendation: "Focus on the top 2 columns and apply imputation or drop rules.",
    },
    {
      id: "duplicates",
      category: "Uniqueness",
      severity: "med",
      title: "Duplicate rows detected",
      detail: "1.3% duplicate rate across the dataset.",
      recommendation: "Define a primary key and deduplicate by business priority.",
    },
    {
      id: "schema",
      category: "Schema",
      severity: "low",
      title: "Minor schema drift",
      detail: "1 column has changed inferred type.",
      recommendation: "Confirm the source mapping for that column.",
    },
  ],
};

const severityStyles: Record<Severity, string> = {
  low: "bg-emerald-100 text-emerald-700",
  med: "bg-amber-100 text-amber-700",
  high: "bg-rose-100 text-rose-700",
};

export default function HealthDiagnosticView() {
  const [hasFile, setHasFile] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const grouped = useMemo(() => {
    if (!result) return [];
    const groups: Record<string, Finding[]> = {};
    result.findings.forEach((finding) => {
      groups[finding.category] = groups[finding.category] || [];
      groups[finding.category].push(finding);
    });
    return Object.entries(groups);
  }, [result]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-slate-900">
          Health Diagnostic
        </div>
        <div className="text-sm text-slate-500">
          Run a quick quality assessment with clear next steps and severity labels.
        </div>
      </div>

      {!hasFile && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6">
          <div className="text-sm font-semibold text-slate-900">
            No file selected
          </div>
          <div className="mt-2 text-sm text-slate-500">
            Upload or select a file to run diagnostics. You can also preview the
            experience with sample data.
          </div>
          <button
            onClick={() => {
              setHasFile(true);
              setResult(null);
            }}
            className="mt-4 rounded-lg bg-[#00A3E0] px-4 py-2 text-sm font-semibold text-white"
          >
            Use Sample Data
          </button>
        </div>
      )}

      {hasFile && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Diagnostics Run
              </div>
              <div className="text-sm text-slate-500">
                Summaries, issues, and recommendations based on the active file.
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setResult(demoResult)}
                className="rounded-lg bg-[#00A3E0] px-4 py-2 text-sm font-semibold text-white"
              >
                Run Diagnostics
              </button>
              <button
                onClick={() => {
                  setResult(null);
                  setHasFile(false);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Clear
              </button>
            </div>
          </div>

          {!result && (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
              Click "Run Diagnostics" to generate summary cards and findings.
            </div>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              { label: "Overall Score", value: result.score, sub: `Grade ${result.grade}` },
              { label: "Rows", value: result.rows, sub: "Record count" },
              { label: "Columns", value: result.columns, sub: "Field count" },
              { label: "Missing Rate", value: result.missingRate, sub: "Across dataset" },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-2xl border border-slate-200 bg-white p-4"
              >
                <div className="text-xs font-medium text-slate-500">
                  {card.label}
                </div>
                <div className="mt-2 text-2xl font-semibold text-[#00A3E0]">
                  {card.value}
                </div>
                <div className="mt-1 text-xs text-slate-500">{card.sub}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">
              Findings by Category
            </div>
            <div className="mt-4 space-y-4">
              {grouped.map(([category, findings]) => (
                <div key={category} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-900">
                      {category}
                    </div>
                    <div className="text-xs text-slate-500">
                      {findings.length} issues
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {findings.map((finding) => (
                      <div
                        key={finding.id}
                        className="rounded-xl border border-slate-200 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">
                            {finding.title}
                          </div>
                          <span
                            className={[
                              "rounded-full px-2 py-1 text-xs font-semibold",
                              severityStyles[finding.severity],
                            ].join(" ")}
                          >
                            {finding.severity.toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {finding.detail}
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-700">
                          What to do next
                        </div>
                        <div className="text-xs text-slate-500">
                          {finding.recommendation}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
