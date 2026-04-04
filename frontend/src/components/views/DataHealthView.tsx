/**
 * DataHealthView — sidebar/panel stub
 *
 * This component is kept as a lightweight placeholder.
 * The live Data Health diagnostics are rendered by
 * HealthDiagnosticView inside the file detail page.
 */
export default function DataHealthView() {
  return (
    <div className="space-y-4 px-2">
      <div>
        <div className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Data Health
        </div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Select a file from the sidebar, then open the{" "}
          <strong>Data Health</strong> tab to see your quality score, issues,
          and field-by-field breakdown.
        </div>
      </div>
    </div>
  );
}
