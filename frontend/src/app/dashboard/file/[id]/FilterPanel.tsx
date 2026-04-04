"use client";

import React from "react";

type FiltersProps = {
  filters: Record<string, string[]>;
  selected: Record<string, string | null>;
  onChange: (key: string, value: string | null) => void;
  onClear: () => void;
  onApply?: () => void;
};

export default function FilterPanel({
  filters,
  selected,
  onChange,
  onClear,
  onApply,
}: FiltersProps) {
  const filterKeys = Object.keys(filters || {});

  if (filterKeys.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] px-2">
        No filters detected in this dataset.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-main)]">Filters</h2>

        <div className="flex items-center gap-2">
          {onApply && (
            <button
              onClick={onApply}
              className="text-xs rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-main)] hover:bg-[color:var(--bg-panel-2)]"
              type="button"
            >
              Apply
            </button>
          )}

          <button
            onClick={onClear}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
            type="button"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Filter Inputs */}
      {filterKeys.map((col) => (
        <div key={col} className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {col}
          </label>

          <select
            className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-panel)] px-2 py-1.5 text-sm text-[var(--text-main)]"
            value={selected[col] ?? ""}
            onChange={(e) => onChange(col, e.target.value || null)}
          >
            <option value="">All</option>
            {filters[col].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      ))}

    </div>
  );
}
