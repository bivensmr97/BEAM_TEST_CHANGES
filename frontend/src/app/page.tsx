// frontend/src/app/page.tsx
"use client";

import { useState } from "react";
import TopNav from "@/components/TopNav";

import RightToolsPanel from "../components/RightToolsPanel";
import FileInsightsView from "../components/views/FileInsightsView";
import DataHealthView from "../components/views/DataHealthView";

type ToolKey = "insights" | "data-health";

export default function Home() {
  const [activeTool, setActiveTool] = useState<ToolKey>("insights");

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      {/* ✅ HEADER */}
      <TopNav />

      {/* APP SHELL */}
      <div className="flex min-h-[calc(100vh)]">
        <aside className="w-[300px] shrink-0 border-r border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-zinc-800 dark:bg-black/40">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Upload a File
          </div>

          <div className="mt-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <input type="file" className="w-full text-sm" />
            <button className="mt-3 w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-white">
              Upload
            </button>
          </div>

          <div className="mt-6 text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
            FILES
          </div>
          <div className="mt-2 rounded-xl border border-zinc-200 p-3 text-sm text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            Walmart_Sales.csv
          </div>
        </aside>

        <main className="flex-1 p-8">
          {activeTool === "insights" ? <FileInsightsView /> : <DataHealthView />}
        </main>

        <RightToolsPanel activeTool={activeTool} onChange={setActiveTool} />
      </div>
    </div>
  );
}
