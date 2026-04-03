export default function DataHealthView() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Data Health
        </div>
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          Quality scoring + checks (nulls, duplicates, schema drift, outliers, etc.)
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          { label: "Overall Score", value: "86", sub: "Grade: A-" },
          { label: "Completeness", value: "92", sub: "Missing values low" },
          { label: "Validity", value: "81", sub: "Type/format issues" },
          { label: "Uniqueness", value: "74", sub: "Duplicates detected" },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black"
          >
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {c.label}
            </div>
            <div className="mt-2 text-3xl font-semibold text-emerald-500">
              {c.value}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {c.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-black">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Checks
        </div>

        <div className="mt-3 space-y-2 text-sm">
          {[
            { name: "Missing values", status: "OK", detail: "2 columns > 5%" },
            { name: "Duplicates", status: "WARN", detail: "1.3% duplicate rows" },
            { name: "Outliers", status: "OK", detail: "Within expected bounds" },
            { name: "Schema drift", status: "OK", detail: "No changes detected" },
          ].map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <div>
                <div className="font-medium text-zinc-900 dark:text-zinc-50">
                  {r.name}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {r.detail}
                </div>
              </div>

              <span
                className={[
                  "rounded-full px-2 py-1 text-xs font-semibold",
                  r.status === "OK"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                ].join(" ")}
              >
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
