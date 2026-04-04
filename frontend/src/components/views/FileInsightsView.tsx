/**
 * FileInsightsView — sidebar/panel stub
 *
 * This component is kept as a lightweight placeholder.
 * The live File Insights (charts, KPIs) are rendered by
 * the file detail page at /dashboard/file/[id].
 */
export default function FileInsightsView() {
  return (
    <div className="space-y-4 px-2">
      <div>
        <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          File Insights
        </div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Select a file from the sidebar to view charts and key metrics for
          your uploaded dataset.
        </div>
      </div>
    </div>
  );
}
