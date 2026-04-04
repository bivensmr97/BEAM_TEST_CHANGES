"use client";

import { AuthGuard } from "@/components/AuthGuard";

export default function DashboardPage() {
  return (
    <AuthGuard>
      <div className="px-6 py-8 max-w-2xl">
        {/* Welcome header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[var(--text-main)]">
            Welcome to BEAM Analytics
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed">
            BEAM helps you understand the health and quality of your business data
            — without needing a data team.
          </p>
        </div>

        {/* Getting started steps */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--text-main)] uppercase tracking-wide">
            Getting Started
          </h2>

          {[
            {
              step: "1",
              title: "Upload a file",
              description:
                'Use the "Upload a File" panel on the left to upload a CSV or Excel spreadsheet from your business. This could be a customer list, sales report, policy register, or any other dataset.',
            },
            {
              step: "2",
              title: "View your file overview",
              description:
                "Once uploaded, click your file name in the sidebar. The File Overview tab shows key metrics and charts to help you understand what's in your data.",
            },
            {
              step: "3",
              title: "Check your data health score",
              description:
                'Switch to the "Data Health" tab to see a quality score out of 100, plain-English explanations of any issues found, and a field-by-field breakdown. No data background required.',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex gap-4 rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-4"
            >
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-sm font-bold text-cyan-300">
                {item.step}
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-main)]">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Supported formats */}
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[color:var(--bg-panel)] p-4">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
            Supported file types
          </p>
          <div className="flex gap-3 text-sm">
            <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-main)]">
              CSV
            </span>
            <span className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-main)]">
              Excel (.xlsx)
            </span>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Maximum file size: 50 MB
          </p>
        </div>
      </div>
    </AuthGuard>
  );
}
