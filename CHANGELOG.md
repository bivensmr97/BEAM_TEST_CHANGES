# Changelog

All notable changes to the BEAM Analytics platform are documented here.

---

## [Unreleased] — 2026-04-03 (Pass 3 — Presentation Polish)

### Added / Changed (Pass 3)

#### Frontend Presentation Fixes

- **Removed dead preset filter buttons** — the "High-Value Records", "Missing Data Check", and "Outliers" preset buttons in `FilterPanel.tsx` did nothing when clicked. They have been removed to prevent client confusion and restore trust in the UI. The `onApplyPreset` prop has been removed from the component entirely.
- **TopNav subtitle updated** — "Multi-tenant ingest & insights" changed to "Data Quality Platform". The technical `user.role` badge (admin/user) has been removed from the nav bar; it is meaningless to business users.
- **AI button relabelled** — the floating cyan circle labeled "AI" is now labeled "AI Summary" with a descriptive `title` tooltip ("Get an AI-generated summary of your file's contents and quality") and a full `aria-label` for accessibility. The button shape is now pill-style to accommodate the longer label.

---

## [Unreleased] — 2026-04-03

### Summary
This release delivers a two-phase expert review followed by comprehensive diagnostic, visualization, and UX improvements. Every change was driven by findings documented in `TECHNICAL_REVIEW.md` and `BUSINESS_REVIEW.md`.

---

### Added

#### Diagnostic Logic (`backend/app/routers/files.py`)

- **Per-column completeness breakdown** — the health response now includes a `column_details` array with `null_rate`, `null_count`, `distinct_count`, and numeric statistics (min, max, mean, median, std dev) for every column.
- **Outlier detection via IQR** — replaced the 3-sigma heuristic (which assumes normal distributions) with the interquartile-range (IQR × 1.5) method. Per-column outlier counts are surfaced in both the issues list and the column detail table.
- **Validity checks expanded** — now detects: numeric values stored as text strings, inconsistent date formats, and invalid email addresses (when the column name suggests it is an email field).
- **Plain-language issues** — every `IssueOut` now contains `title`, `plain_message`, and `recommendation` written for a non-technical audience. Jargon ("missingness", "imputing", "winsorize", "upstream ingestion") has been removed.
- **Severity taxonomy updated** — severities now use `critical / warning / info` (replacing `high / med / low`) to match plain-English conventions.
- **`score_label` field** — the health response now includes a human-readable label for the overall score (e.g., "Good — minor issues worth reviewing").
- **`category_labels` field** — each scoring dimension now has a friendly label (e.g., "Complete Information" instead of "completeness").
- **`duplicate_count`** — the exact number of duplicate rows is returned (previously only the rate was returned).
- **Weighted scoring** — overall score is now a documented weighted average: Completeness 35%, Uniqueness 30%, Validity 20%, Distribution 15%. Previously it was an unweighted mean.

#### Visualization (`backend/app/insights.py`)

- **Missing Data by Field chart** — the first chart shown is now a horizontal bar chart ranking every field by its percentage of missing values, colour-coded (green/amber/red). This directly answers "which of my columns have empty data?".
- **ID-like column filtering** — columns that appear to be sequential IDs or index numbers are now excluded from histograms and KPI averages. Previously, "Average PassengerId" and similar nonsense metrics were shown.
- **Interesting column selection** — histograms and category breakdowns now skip ID-like columns and columns with very low or very high cardinality. Up to 3 numeric and 2 categorical columns are charted.
- **Plain-language chart titles and axis labels** — snake_case column names are now formatted to Title Case (e.g., `sales_amount_usd` → "Sales Amount Usd"). Chart key names (histogram_1_col_name) are formatted into readable titles on the frontend.
- **KPI label changed** — "Total Rows" renamed to "Total Records" for non-technical audiences.
- **AI summary is now non-blocking** — if the OpenAI API is unavailable or returns an error, the insights response is returned without the summary field rather than returning an error. Prompt updated to explicitly request plain English output suitable for a business owner.
- **Memory guard on blob reads** — `MAX_ROWS_LOAD = 500_000` cap added to prevent OOM on very large files. Charts capped at 50,000 rows (unchanged).
- **Encoding fallback** — CSV reads now fall back to Latin-1 encoding on `UnicodeDecodeError` (this was already present in `insights.py` but was missing from `files.py`).

#### Frontend

- **Data Health tab** — the file detail page (`/dashboard/file/[id]`) now has two tabs: "File Overview" (existing KPIs and charts) and "Data Health" (new, described below).
- **`HealthDiagnosticView` component** — new component that calls the `/health` endpoint and renders:
  - A circular score ring with grade letter
  - Plain-English score label
  - Four dimension progress bars (Complete Information, No Duplicate Records, Correct Formatting, Realistic Values)
  - Issue cards sorted by severity (critical → warning → note), each with a plain-language explanation and recommended action
  - A collapsible field-by-field breakdown table sorted by worst completeness first
- **Dashboard welcome page** — the landing page now displays a 3-step onboarding guide ("Upload a file", "View your file overview", "Check your data health score") instead of the bare "Select a file from the sidebar" placeholder.
- **Jargon removed from registration** — "Create your tenant" → "Create your account"; "Tenant name" → "Company name"; "Creating tenant…" → "Creating account…".
- **`DataHealthView` and `FileInsightsView` stubs updated** — these components (used in the component library) no longer show hardcoded fake data. They now display a short redirect message pointing users to the real file detail page.
- **Chart name formatting** — internal chart keys (e.g., `missing_data_by_field`, `distribution_1_Sales`) are formatted into readable titles on the frontend using the `formatChartName()` helper.

#### Stability

- **50 MB upload size limit** — `upload_file()` now checks `len(data) > MAX_UPLOAD_BYTES` and returns HTTP 413 with a plain-English error message. Previously there was no limit.
- **Encoding fallback in `files.py`** — `_load_dataframe_from_blob()` now falls back to Latin-1 on `UnicodeDecodeError` (was missing; present only in `insights.py`).
- **Empty file guard** — `file_health()` returns HTTP 422 with a clear error if the uploaded file contains no data rows.
- **`_safe_float()` helper** — all numeric statistics (min, max, mean, etc.) pass through a helper that converts NaN/Inf to `None` before serialisation, preventing FastAPI JSON encoding errors.

#### Documentation

- **`README.md`** — written from scratch. Covers: what the tool does, architecture diagram, key file index, health scoring methodology, multi-tenant isolation, local development setup, deployment, supported file types, and known limitations.
- **`TECHNICAL_REVIEW.md`** — structured findings report covering diagnostic logic, visualization layer, code stability, architecture issues, dead code inventory, and a prioritised issue table.
- **`BUSINESS_REVIEW.md`** — findings report written from the perspective of a non-technical SMB owner evaluating the tool for the first time.

---

### Changed

- `IssueOut.severity` values updated from `"high"/"med"/"low"` to `"critical"/"warning"/"info"`.
- `HealthOut` response shape extended with `score_label`, `category_labels`, `column_details`, `total_rows`, `total_columns`, `duplicate_count`.
- Chart generation in `insights.py` completely rewritten — default charts now serve data quality questions, not arbitrary column indices.
- `generate_ai_summary()` prompt updated for plain-English output; function now returns `None` on failure instead of an error string.

---

### Fixed

- Fixed: `DataHealthView.tsx` and `FileInsightsView.tsx` were displaying hardcoded fake scores and "chart placeholder" boxes instead of real data or a clear message.
- Fixed: `files.py::_load_dataframe_from_blob()` had no encoding fallback — Latin-1 CSVs would crash with an unhandled `UnicodeDecodeError`.
- Fixed: No file size limit on upload endpoint — large uploads could exhaust container memory.
- Fixed: KPI cards showed nonsensical averages for ID columns (e.g., "Average PassengerId").

---

### Deprecated / Removed (dead code)

- `backend/app/services/data_health.py` — replaced with a deprecation notice. Logic lives in `files.py`.
- `backend/app/services/file_insights.py` — replaced with a deprecation notice. Logic lives in `insights.py`.
- (Note: `backend/app/routers/tools.py` is also dead code — not mounted in `main.py`. Left in place to avoid breaking potential external integrations, but marked as unused in `TECHNICAL_REVIEW.md`.)

---

### Assumptions

- The `tools.py` router and the service layer it calls are intentionally dead code (not mounted). They are deprecated rather than deleted to minimise the blast radius of this review iteration.
- The correlation heatmap was removed from the default chart set. It provided no business value to non-technical users and added visual noise.
- The `HealthIn.yaml_config` parameter is accepted but not yet consumed. It is preserved for future rule configuration without changing the API contract.
