"use client";

import React, { useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type DedupeMode = "full_row" | "columns";
type KeepStrategy = "first" | "last";

type PreviewResult = {
  original_rows: number;
  duplicate_count: number;
  cleaned_rows: number;
  pct_removed: number;
};

export default function DedupePanel({
  fileId,
  token,
  columns,
  sheetName,
  duplicateCount,
}: {
  fileId: string;
  token: string;
  columns: string[];
  sheetName?: string | null;
  duplicateCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DedupeMode>("full_row");
  const [selectedCols, setSelectedCols] = useState<string[]>([]);
  const [keep, setKeep] = useState<KeepStrategy>("first");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCol(col: string) {
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
    setPreview(null);
  }

  function buildPayload() {
    return {
      mode,
      columns: mode === "columns" ? selectedCols : [],
      keep,
      sheet_name: sheetName ?? null,
    };
  }

  async function runPreview() {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/dedupe/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Could not run deduplicate preview");
      }
      setPreview((await res.json()) as PreviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run preview");
    } finally {
      setLoading(false);
    }
  }

  async function downloadCleaned() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/files/${fileId}/dedupe/download`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildPayload()),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Download failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
      const filename = match?.[1]
        ? decodeURIComponent(match[1].replace(/['"]/g, ""))
        : "deduped.csv";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const canPreview =
    mode === "full_row" || (mode === "columns" && selectedCols.length > 0);

  if (!open) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-main)]">
            Remove duplicate rows
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {duplicateCount.toLocaleString()} duplicate{duplicateCount === 1 ? " row" : " rows"} detected —
            download a cleaned copy of your file.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2"
        >
          Fix duplicates
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-[color:var(--bg-panel)] p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-main)]">Remove duplicate rows</h3>
        <button
          type="button"
          onClick={() => { setOpen(false); setPreview(null); setError(null); }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          Close
        </button>
      </div>

      {/* Mode */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          Match duplicates by
        </p>
        <div className="flex gap-2">
          {(["full_row", "columns"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setPreview(null); }}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium border transition-colors",
                mode === m
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]",
              ].join(" ")}
            >
              {m === "full_row" ? "Entire row" : "Specific columns"}
            </button>
          ))}
        </div>
        {mode === "full_row" && (
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Rows where every field is identical will be treated as duplicates.
          </p>
        )}
      </div>

      {/* Column selector */}
      {mode === "columns" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
            Columns to match on
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Select the fields that together identify a unique record.
          </p>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {columns.map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => toggleCol(col)}
                className={[
                  "rounded-md px-2.5 py-1 text-xs font-medium border transition-colors",
                  selectedCols.includes(col)
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]",
                ].join(" ")}
              >
                {col}
              </button>
            ))}
          </div>
          {selectedCols.length === 0 && (
            <p className="text-xs text-amber-400">Select at least one column to continue.</p>
          )}
        </div>
      )}

      {/* Keep strategy */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
          When duplicates are found, keep
        </p>
        <div className="flex gap-2">
          {(["first", "last"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setKeep(k); setPreview(null); }}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium border transition-colors",
                keep === k
                  ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]",
              ].join(" ")}
            >
              {k === "first" ? "First occurrence" : "Last occurrence"}
            </button>
          ))}
        </div>
      </div>

      {/* Preview button */}
      {!preview && (
        <button
          type="button"
          onClick={runPreview}
          disabled={loading || !canPreview}
          className="w-full rounded-md bg-[color:var(--bg-panel-2)] border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] hover:bg-[color:var(--bg-main)] disabled:opacity-50 transition-colors"
        >
          {loading ? "Calculating…" : "Preview result"}
        </button>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Preview result */}
      {preview && (
        <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-main)] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Original rows" value={preview.original_rows.toLocaleString()} />
            <Stat
              label="Duplicates removed"
              value={preview.duplicate_count.toLocaleString()}
              highlight={preview.duplicate_count > 0 ? "amber" : "green"}
            />
            <Stat label="Cleaned rows" value={preview.cleaned_rows.toLocaleString()} />
            <Stat
              label="Reduction"
              value={`${preview.pct_removed}%`}
              highlight={preview.pct_removed > 0 ? "amber" : "green"}
            />
          </div>

          {preview.duplicate_count === 0 ? (
            <p className="text-xs text-emerald-400 font-medium">
              No duplicates found with these settings — nothing to remove.
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={downloadCleaned}
                disabled={downloading}
                className="flex-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2"
              >
                {downloading ? "Preparing download…" : `Download cleaned file (${preview.cleaned_rows.toLocaleString()} rows)`}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Change settings
              </button>
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-muted)]">
        Your original file is never modified. The cleaned copy is downloaded to your device.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "amber" | "green";
}) {
  const color =
    highlight === "amber"
      ? "text-amber-400"
      : highlight === "green"
      ? "text-emerald-400"
      : "text-[var(--text-main)]";
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
