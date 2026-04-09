"use client";

import React, { useState } from "react";
import AIInsights from "./AIInsights";

export default function AIWidget({
  fileId,
  initialSummary,
  token,
  sheetName,
}: {
  fileId: string;
  initialSummary: string | null;
  token: string;
  sheetName?: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating AI Summary Button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-full shadow-xl transition-transform px-4 py-3 text-sm"
        type="button"
        title="Get an AI-generated summary of your file's contents and quality"
        aria-label="AI Summary — get an AI-generated summary of this file"
      >
        AI Summary
      </button>

      {/* Slide-up Panel */}
      <div
        className={`fixed right-6 bottom-24 w-96 rounded-2xl border border-[var(--border)] bg-[color:var(--bg-panel)] shadow-2xl overflow-hidden transition-all duration-300 ${
          open
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-6 pointer-events-none"
        }`}
        style={{
          // makes it feel like it "fits" content but never grows beyond viewport
          maxHeight: "70vh",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[color:var(--bg-panel)]">
          <div className="text-sm font-semibold text-[var(--text-main)]">AI Insights</div>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs"
            type="button"
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <AIInsights
            fileId={fileId}
            initialSummary={initialSummary}
            token={token}
            sheetName={sheetName}
          />
        </div>
      </div>
    </>
  );
}
