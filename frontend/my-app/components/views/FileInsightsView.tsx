export default function FileInsightsView() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          File Insights
        </div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Keep your current insights placeholder here (or wire it to backend).
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {["Total Rows", "Average Store", "Average Weekly Sales"].map((k) => (
          <div
            key={k}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black"
          >
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {k}
            </div>
            <div className="mt-2 text-2xl font-semibold text-cyan-500">
              {/* dummy */}
              123
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Histogram
        </div>
        <div className="mt-3 h-[280px] rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-400">
          chart placeholder
        </div>
      </div>
    </div>
  );
}
