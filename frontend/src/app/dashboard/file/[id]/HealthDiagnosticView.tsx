"use client";

/**
 * HealthDiagnosticView
 *
 * Calls the backend POST /api/files/{fileId}/health endpoint and renders
 * the results in plain English for a non-technical business user.
 *
 * Design principles:
 *  - No jargon visible to the user
 *  - Score + grade shown prominently
 *  - Each issue has a severity badge, plain explanation, and next step
 *  - Per-column breakdown is a collapsible table, sorted by worst first
 */

import React, { useEffect, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueOut = {
  key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  plain_message: string;
  recommendation: string;
};

type ColumnDetail = {
  name: string;
  null_rate: number;
  null_count: number;
  distinct_count: number;
  total_count: number;
  inferred_type: string;
  min_value: number | null;
  max_value: number | null;
  mean_value: number | null;
  median_value: number | null;
  std_dev: number | null;
  outlier_count: number | null;
  top_values: { value: string; count: number }[];
};

type HealthResponse = {
  score: number;
  grade: string;
  score_label: string;
  category_scores: Record<string, number>;
  category_labels: Record<string, string>;
  issues: IssueOut[];
  column_details: ColumnDetail[];
  total_rows: number;
  total_columns: number;
  duplicate_count: number;
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const color =
    score >= 90
      ? "#22c55e"
      : score >= 80
      ? "#84cc16"
      : score >= 70
      ? "#f59e0b"
      : score >= 60
      ? "#f97316"
      : "#ef4444";

  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className="relative flex items-center justify-center rounded-full w-28 h-28 border-8"
        style={{ borderColor: color }}
      >
        <div>
          <p className="text-3xl font-bold text-[var(--text-main)]">{score}</p>
          <p className="text-center text-xs text-[var(--text-muted)]">/ 100</p>
        </div>
      </div>
      <p className="mt-2 text-xl font-semibold" style={{ color }}>
        Grade {grade}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800",
    info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800",
  };
  const labels: Record<string, string> = {
    critical: "Critical",
    warning: "Warning",
    info: "Note",
  };

  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
        styles[severity] ?? styles.info
      }`}
    >
      {labels[severity] ?? severity}
    </span>
  );
}

function IssueCard({ issue }: { issue: IssueOut }) {
  const borderColor =
    issue.severity === "critical"
      ? "border-red-400/50"
      : issue.severity === "warning"
      ? "border-amber-400/50"
      : "border-blue-400/30";

  return (
    <div
      className={`rounded-xl border ${borderColor} bg-[color:var(--bg-panel)] p-4 space-y-2`}
    >
      <div className="flex items-start gap-3">
        <SeverityBadge severity={issue.severity} />
        <p className="font-semibold text-[var(--text-main)] text-sm leading-snug">
          {issue.title}
        </p>
      </div>

      <p className="text-sm text-[var(--text-muted)] leading-relaxed">
        {issue.plain_message}
      </p>

      <div className="rounded-lg bg-[color:var(--bg-main)] border border-[var(--border)] px-3 py-2">
        <p className="text-xs font-semibold text-[var(--text-main)] mb-0.5">
          Recommended action
        </p>
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {issue.recommendation}
        </p>
      </div>
    </div>
  );
}

function CategoryScoreBar({
  label,
  score,
}: {
  label: string;
  score: number;
}) {
  const color =
    score >= 90
      ? "#22c55e"
      : score >= 75
      ? "#84cc16"
      : score >= 60
      ? "#f59e0b"
      : "#ef4444";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-[var(--text-main)] font-medium">{label}</span>
        <span className="text-[var(--text-muted)]">{score.toFixed(0)}/100</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[color:var(--bg-main)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function ColumnTable({ columns }: { columns: ColumnDetail[] }) {
  const [open, setOpen] = useState(false);

  const sorted = [...columns].sort((a, b) => b.null_rate - a.null_rate);

  function friendlyName(col: string) {
    return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function nullBadge(rate: number) {
    if (rate === 0)
      return <span className="text-emerald-500 text-xs font-medium">Complete</span>;
    const pct = (rate * 100).toFixed(1);
    const color =
      rate > 0.2
        ? "text-red-400"
        : rate > 0.05
        ? "text-amber-400"
        : "text-yellow-400";
    return <span className={`text-xs font-medium ${color}`}>{pct}% empty</span>;
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)]">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-[var(--text-main)]"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>Field-by-Field Breakdown ({columns.length} fields)</span>
        <span className="text-[var(--text-muted)] text-xs">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="px-4 py-2 text-left font-medium">Field Name</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">Completeness</th>
                <th className="px-4 py-2 text-left font-medium">Unique Values</th>
                <th className="px-4 py-2 text-left font-medium">Min</th>
                <th className="px-4 py-2 text-left font-medium">Max</th>
                <th className="px-4 py-2 text-left font-medium">Average</th>
                <th className="px-4 py-2 text-left font-medium">Unusual Values</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((col) => (
                <tr
                  key={col.name}
                  className="border-b border-[var(--border)] hover:bg-[color:var(--bg-main)]"
                >
                  <td className="px-4 py-2 font-medium text-[var(--text-main)] max-w-[160px] truncate">
                    {friendlyName(col.name)}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)] capitalize">
                    {col.inferred_type}
                  </td>
                  <td className="px-4 py-2">{nullBadge(col.null_rate)}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">
                    {col.distinct_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">
                    {col.min_value != null ? col.min_value.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">
                    {col.max_value != null ? col.max_value.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">
                    {col.mean_value != null ? col.mean_value.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {col.outlier_count != null && col.outlier_count > 0 ? (
                      <span className="text-amber-400">{col.outlier_count.toLocaleString()}</span>
                    ) : (
                      <span className="text-emerald-500">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HealthDiagnosticView({
  fileId,
  token,
}: {
  fileId: string;
  token: string;
}) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId || !token) return;
    let cancelled = false;

    async function fetchHealth() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/health`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Health check failed (${res.status}): ${text || res.statusText}`);
        }

        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setHealth(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Could not load health diagnostics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchHealth();
    return () => { cancelled = true; };
  }, [fileId, token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[var(--text-muted)]">
        <div className="text-center space-y-2">
          <div className="animate-pulse text-2xl">🔍</div>
          <p>Analysing your data…</p>
          <p className="text-xs">This may take a few seconds for larger files.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-4 text-sm text-red-300 space-y-1">
        <p className="font-semibold">Could not run health check</p>
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (!health) return null;

  const criticalCount = health.issues.filter((i) => i.severity === "critical").length;
  const warningCount = health.issues.filter((i) => i.severity === "warning").length;

  return (
    <div className="space-y-6">
      {/* ---- Score Header ---- */}
      <div className="rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing score={health.score} grade={health.grade} />

          <div className="flex-1 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-main)]">
                {health.score_label}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Analysed{" "}
                <strong className="text-[var(--text-main)]">
                  {health.total_rows.toLocaleString()} records
                </strong>{" "}
                across{" "}
                <strong className="text-[var(--text-main)]">
                  {health.total_columns} fields
                </strong>
                {health.duplicate_count > 0 && (
                  <>
                    {" "}·{" "}
                    <span className="text-amber-400">
                      {health.duplicate_count.toLocaleString()} duplicate records found
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Category bars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(health.category_scores).map(([key, score]) => (
                <CategoryScoreBar
                  key={key}
                  label={health.category_labels[key] ?? key}
                  score={score}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Issue count summary */}
        {health.issues.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-3 text-sm">
            {criticalCount > 0 && (
              <span className="text-red-400">
                ⚠ {criticalCount} critical {criticalCount === 1 ? "issue" : "issues"}
              </span>
            )}
            {warningCount > 0 && (
              <span className="text-amber-400">
                ⚡ {warningCount} {warningCount === 1 ? "warning" : "warnings"}
              </span>
            )}
            {health.issues.filter((i) => i.severity === "info").length > 0 && (
              <span className="text-blue-400">
                ℹ {health.issues.filter((i) => i.severity === "info").length}{" "}
                {health.issues.filter((i) => i.severity === "info").length === 1
                  ? "note"
                  : "notes"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ---- Issues List ---- */}
      {health.issues.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-main)]">
            What We Found
          </h3>
          {/* Show critical first, then warnings, then info */}
          {(["critical", "warning", "info"] as const).map((sev) =>
            health.issues
              .filter((i) => i.severity === sev)
              .map((issue) => <IssueCard key={issue.key} issue={issue} />)
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 text-center">
          <p className="text-emerald-400 font-semibold text-lg">✓ No significant issues found</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Your dataset passed all health checks. Keep up the good work!
          </p>
        </div>
      )}

      {/* ---- Field-by-Field Breakdown ---- */}
      {health.column_details.length > 0 && (
        <ColumnTable columns={health.column_details} />
      )}
    </div>
  );
}
