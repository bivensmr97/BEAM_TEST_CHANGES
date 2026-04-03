"use client";

import { useMemo, useState } from "react";
import HealthDiagnosticView from "../components/views/HealthDiagnosticView";
import BuildDashboardView from "../components/views/BuildDashboardView";
import TemplateDashboardView from "../components/views/TemplateDashboardView";

type ToolKey = "health" | "byod" | "template";

const toolLabels: Record<ToolKey, string> = {
  health: "Health Diagnostic",
  byod: "Build Your Own Dashboard",
  template: "Template Dashboard",
};

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolKey>("health");
  const navItems = useMemo(() => Object.keys(toolLabels) as ToolKey[], []);

  return (
    <div className="flex min-h-screen bg-[#F5F7FA] font-sans">
      {/* LEFT SIDEBAR */}
      <aside className="w-[300px] shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-900">Upload a File</div>

        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <input type="file" className="w-full text-sm" />
          <button className="mt-3 w-full rounded-lg bg-[#00A3E0] px-3 py-2 text-sm font-semibold text-white">
            Upload
          </button>
        </div>

        <div className="mt-6 text-xs font-semibold tracking-wide text-slate-500">
          FILES
        </div>
        <div className="mt-2 rounded-xl border border-slate-200 p-3 text-sm text-slate-900">
          Walmart_Sales.csv
        </div>
      </aside>

      {/* CENTER CONTENT */}
      <main className="flex-1">
        <div className="border-b border-slate-200 bg-[#002B5B] px-8 py-6 text-white">
          <div className="text-2xl font-semibold">BEAM Analytics</div>
          <div className="text-sm text-white/80">
            Executive-ready insights from your tenant data
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white px-8 py-4">
          {navItems.map((key) => {
            const active = key === activeTool;
            return (
              <button
                key={key}
                onClick={() => setActiveTool(key)}
                className={[
                  "rounded-full px-4 py-2 text-sm font-semibold transition",
                  active
                    ? "bg-[#00A3E0] text-white"
                    : "bg-[#F5F7FA] text-slate-700 hover:bg-slate-100",
                ].join(" ")}
              >
                {toolLabels[key]}
              </button>
            );
          })}
        </div>

        <div className="p-8">
          {activeTool === "health" && <HealthDiagnosticView />}
          {activeTool === "byod" && <BuildDashboardView />}
          {activeTool === "template" && <TemplateDashboardView />}
        </div>
      </main>
    </div>
  );
}
