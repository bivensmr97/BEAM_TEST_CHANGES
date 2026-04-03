"use client";

type ToolKey = "insights" | "data-health";

export default function RightToolsPanel({
  activeTool,
  onChange,
}: {
  activeTool: ToolKey;
  onChange: (tool: ToolKey) => void;
}) {
  const tools: { key: ToolKey; label: string; desc: string }[] = [
    { key: "insights", label: "File Insights", desc: "Summary stats & charts" },
    { key: "data-health", label: "Data Health", desc: "Quality checks & scoring" },
  ];

  return (
    <aside className="w-[320px] shrink-0 border-l bg-white/70 p-4 backdrop-blur dark:bg-black/40">
      <div className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
        TOOLS
      </div>

      <div className="mt-3 space-y-2">
        {tools.map((t) => {
          const active = t.key === activeTool;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={[
                "w-full rounded-xl border p-3 text-left transition",
                active
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                  : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900",
              ].join(" ")}
            >
              <div className="font-medium">{t.label}</div>
              <div
                className={[
                  "mt-1 text-xs",
                  active ? "text-white/80 dark:text-black/70" : "text-zinc-500 dark:text-zinc-400",
                ].join(" ")}
              >
                {t.desc}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
