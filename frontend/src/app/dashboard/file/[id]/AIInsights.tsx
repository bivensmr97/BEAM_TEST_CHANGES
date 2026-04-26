"use client";

import React, { useEffect, useState } from "react";

interface AIInsightsProps {
  fileId: string;
  initialSummary: string | null;
  token: string;
  sheetName?: string | null;
}

export default function AIInsights({ fileId, initialSummary, token, sheetName }: AIInsightsProps) {
  const [summary, setSummary] = useState<string | null>(initialSummary);
  const [loading, setLoading] = useState(false);

  // keep summary updated if initialSummary changes after fetch
  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary]);

  const regenerate = async () => {
    try {
      setLoading(true);

      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
      const res = await fetch(`${base}/api/files/${fileId}/ai-summary`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sheet_name: sheetName }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "AI summary request failed");
      }

      const data = await res.json();
      setSummary(data.summary ?? data.detail ?? null);
    } catch (err) {
      console.error("AI summary error:", err);
      setSummary("AI summary unavailable right now.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-[var(--text-muted)] leading-snug">
          Uses a small sample of your dataset to generate a summary.
        </div>

        <button
          onClick={regenerate}
          disabled={loading}
          className="rounded-md border border-[var(--border)] px-3 py-1 text-xs hover:bg-[color:var(--bg-panel-2)] disabled:opacity-60 shrink-0"
          type="button"
        >
          {loading ? "Generating…" : "Regenerate"}
        </button>
      </div>

      {/* Blue "chat bubble" */}
      <div
        className={[
          "rounded-2xl border",
          "border-cyan-500/30",
          "bg-gradient-to-b from-cyan-500/10 to-[color:var(--bg-panel-2)]",
          "shadow-inner",
        ].join(" ")}
      >
        {/* Bubble header */}
        <div className="px-4 py-2 border-b border-cyan-500/20">
          <div className="text-[11px] uppercase tracking-wide text-cyan-300/90">
            Summary
          </div>
        </div>

        {/* Bubble body (auto height until it hits max, then scrolls) */}
        <div className="px-4 py-3">
          <div className="max-h-[45vh] overflow-y-auto pr-2">
            <div
  className="
    text-sm text-[var(--text-main)] whitespace-pre-wrap
    max-h-[45vh] overflow-y-auto pr-2
    scrollbar-ai
  "
>
  {summary ?? "No AI summary available yet."}
</div>

          </div>
        </div>
      </div>
    </div>
  );
}
