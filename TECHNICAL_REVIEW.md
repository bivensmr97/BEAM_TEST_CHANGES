# Technical Review — BEAM Analytics Data Health Tool

**Reviewer role:** Senior data engineer / SaaS architect  
**Date:** 2026-04-03  
**Codebase state:** Pre-improvement snapshot, branch `claude/review-enhance-diagnostics-1t0xY`

---

## 1. Diagnostic Logic

### What is currently evaluated

| Dimension | Implemented? | Location | Notes |
|---|---|---|---|
| Completeness (null rate) | Partial | `files.py:file_health`, `data_health.py` | Global average only — no per-column breakdown exposed in response |
| Uniqueness (duplicates) | Partial | Both | Whole-row duplicate rate only — no key-column analysis |
| Validity (type conformance) | Shallow | `files.py:file_health` | Regex heuristic for "looks numeric but isn't" — covers maybe 10% of real validity issues |
| Consistency (cross-column logic) | Not implemented | `data_health.py` | Hardcoded placeholder score of 85 |
| Outlier detection | Basic | Both | 3-sigma rule (or z > 4 in `data_health.py`) — no per-column detail in response |
| Distribution summary | Not implemented | — | No min/max/percentile/skew/kurtosis |
| Schema drift | Not implemented | — | No historical comparison capability |
| Format pattern checks | Not implemented | — | No email, phone, date, postal code validation |
| Cardinality analysis | Not implemented | — | No detection of near-constant or near-unique columns |

### Depth and accuracy problems

**Completeness** — Both implementations compute `df.isna().mean().mean()` (a flat average across all cells). This masks columns with 90% missingness if other columns are complete. A per-column null rate breakdown exists in `file_insights` (GET endpoint) but is not exposed in the health score or issues list.

**Validity** — The heuristic (`looks_numeric > 0.6 and fail_rate > 0.2`) is fragile. It only checks 200-row samples, only covers object columns, and only tests for numeric coercibility. Real validity checks (email format, date parsing, enumeration membership, range bounds) are absent.

**Uniqueness** — `df.duplicated().mean()` checks exact whole-row duplicates. Partial duplicates (same customer ID with different timestamps), key-column uniqueness (primary key violations), and near-duplicate records are not checked.

**Outliers** — 3-sigma assumes a normal distribution. For heavily skewed business data (revenue, counts, time series) this produces misleading results. IQR method or percentile-based bounds would be more robust. Per-column outlier count is computed internally but not surfaced in the API response.

**Score calculation** — Two different scoring formulas exist in two files:
- `data_health.py`: Deduction-based (100 minus penalties). Validity hardcoded at 90, consistency at 85.
- `files.py` (the live endpoint): Unweighted average of four `score_from_rate()` values. Validity ("parsing") is a rate of object columns that fail numeric coercion — a very indirect proxy.

Neither formula is documented or transparent to the user. Both are acceptable as prototypes but need to be replaced.

### What is missing for a production-grade tool

1. Per-column completeness table with ranked worst offenders
2. Key-column uniqueness (user-configurable, or auto-detected by cardinality)
3. Format and pattern validation (regex-based, at minimum for email, date, phone)
4. Distribution statistics per numeric column (min, max, p25, p50, p75, p95, skewness)
5. Weighted, transparent scoring with documented dimension weights
6. Severity graduation that maps to actionable thresholds (not just medium/low)
7. Historical drift comparison (upload v1 vs v2 of the same dataset)
8. A configurable rules engine (YAML-driven thresholds referenced but never consumed)

---

## 2. Visualization Layer

### What exists

`backend/app/insights.py::build_charts()` generates three chart types via Plotly:
1. **Histogram** — of the first numeric column only
2. **Bar chart** — of the first categorical column only  
3. **Correlation heatmap** — if ≥ 2 numeric columns exist

These are serialized as Plotly JSON objects and returned to the frontend. The frontend (`file/[id]/page.tsx`) renders them via `react-plotly.js` with theme-aware axis/font colors.

### Quality issues

**Chart selection is hardcoded to column index 0.** For a 45-column dataset, the histogram will always show column[0] regardless of whether it is interesting. A dataset starting with an ID column will produce a histogram of sequential integers — entirely useless.

**Chart titles are column names.** `f"Distribution of {col}"` and `f"{col} Counts"` expose raw column names (often snake_case or abbreviated) to end users without formatting.

**Correlation heatmap is inaccessible to non-technical users.** It appears in the same panel as the histogram and bar chart with no explanation of what it shows or why it matters. For a business user this chart is noise.

**No data quality visualizations exist.** There is no chart showing null rates by column, no duplicate count summary, no outlier distribution — the charts that would be most directly useful for a data health tool are absent.

**No custom visualization builder.** The specification mentions a custom builder; no such feature exists in the production frontend. There are stub components (`DataHealthView.tsx`, `FileInsightsView.tsx`) in the component library, but they contain hardcoded fake data and are not mounted in any real page route.

### Rendering stability

The `_json_safe()` function in `insights.py` properly handles NaN/Inf values before the Plotly payload reaches FastAPI. Chart rendering is guarded with `MAX_ROWS_FOR_CHARTS = 50000`. These are good patterns.

The `react-plotly.js` integration uses `autosize: true` with a fixed-height container (`h-[320px]`), which works but can cause initial rendering flicker on resize. Theme values are computed from CSS custom properties on each render — adequate but not memoized between re-renders caused by filter changes.

---

## 3. Code Stability & Architecture

### Critical: Broken service layer

`backend/app/services/data_health.py` and `backend/app/services/file_insights.py` both contain:

```python
def load_df_for_dataset(dataset_id: str) -> pd.DataFrame:
    path = os.path.join("uploads", f"{dataset_id}.csv")
    return pd.read_csv(path)
```

This reads from a local `uploads/` directory that does not exist in production. All files are stored in Azure Blob Storage. These services would raise `FileNotFoundError` on every call. However, `tools.py` (which uses these services) is **not mounted** in `main.py`, so this bug is dormant rather than live. The dead code should be removed to avoid confusion.

### Duplicate health logic

Health scoring logic exists in two places with different implementations:
- `backend/app/services/data_health.py` (dead code, broken loader)
- `backend/app/routers/files.py` `file_health()` (live, used by frontend)

This creates maintenance risk — future changes may only be applied to one location.

### Duplicate insights endpoint

Both `routers/files.py` and `routers/insights_routes.py` register routes under `/api/files`. The GET insights endpoint lives in `files.py`, the POST insights endpoint in `insights_routes.py`. Both are mounted with the same prefix via `main.py`. FastAPI handles this correctly because they are different HTTP methods, but the split creates confusion about which module owns what.

### Missing file size limit

`files.py::upload_file()` calls `await uploaded_file.read()` with no size guard. A 500 MB CSV would be read entirely into memory before any validation. This is a significant DoS risk and a practical performance problem.

```python
data = await uploaded_file.read()  # No size limit — reads entire file into RAM
```

### No memory guard on DataFrame operations

`insights.py` limits chart data to 50,000 rows, but the full DataFrame is loaded for KPI and filter computation with no row limit. A 10M-row CSV would exhaust container memory. `files.py::file_health()` loads the entire file with no guard.

### Encoding handling

`insights.py::load_file_from_blob()` handles UTF-8/Latin-1 fallback for CSV:
```python
try:
    df = pd.read_csv(io.BytesIO(data))
except UnicodeDecodeError:
    df = pd.read_csv(io.BytesIO(data), encoding="latin-1")
```
Good pattern. However, `files.py::_load_dataframe_from_blob()` has no encoding fallback — a Latin-1 file would raise an unhandled exception.

### CORS configuration

```python
allow_origins=["*"]
```
This is appropriate for local development but should be locked to the frontend domain in production. Currently noted — not a blocking issue but should be environment-gated.

### Multi-tenant isolation — assessment

**Verdict: Isolation is structurally sound.**

- JWT tokens embed `tenant_id`; `get_current_user()` validates the token on every request.
- Every DB query that accesses files filters on `FileModel.tenant_id == user.tenant_id`.
- Azure Blob paths are namespaced as `tenant_{tenant_id}/file_{file_id}/raw/{filename}`.
- There is no raw blob path constructed from user input — file lookups go through the DB record which already contains the correct blob path.

One minor concern: `get_current_user()` retrieves the full `User` object but does not check `tenant.is_active`. The `get_current_tenant()` helper does this check, but most endpoints use `get_current_user()` directly. An inactive tenant's users can still access data.

### Auth & security

- Password hashing uses `bcrypt_sha256` via passlib — appropriate.
- JWT tokens use HS256 with `settings.JWT_SECRET_KEY`. The key is loaded from env — correct.
- Access tokens expire in 30 minutes; refresh tokens in 14 days — reasonable defaults.
- No rate limiting on login or registration endpoints — brute-force risk.
- Registration slug generation is simplistic (`generate_slug` strips spaces/underscores only). Slug collisions are checked but the check is case-insensitive only by accident (both sides of the compare are lowercased by the slug transform, but a direct DB query is case-sensitive depending on the collation).

### Dead code inventory

| File | Status | Note |
|---|---|---|
| `backend/app/routers/tools.py` | Dead — not mounted | Uses broken local-path loaders |
| `backend/app/services/data_health.py` | Dead — only called by tools.py | Broken local-path loader |
| `backend/app/services/file_insights.py` | Dead — only called by tools.py | Broken local-path loader |
| `frontend/src/components/views/DataHealthView.tsx` | Stub — not routed | Hardcoded fake data |
| `frontend/src/components/views/FileInsightsView.tsx` | Stub — not routed | Hardcoded fake data |
| `frontend/my-app/` | Older scaffold — unused | Entire directory is abandoned |
| `Older Build/` | Abandoned — unused | Older monolithic Flask app |
| `custom_dashboard_template.py` (root) | Unused | Standalone script |

### Performance bottlenecks

1. **Every request reloads the DataFrame from Azure Blob.** No caching layer exists. A user who refreshes the insights page triggers a full blob download and pandas parse each time. For a 50 MB CSV this could be 5–10 seconds of latency.
2. **AI summary generates on every insights load** — an OpenAI API call is embedded in the core `generate_insights()` function. If the API is slow or returns an error, the entire insights response is delayed.
3. **No async I/O for blob reads.** The Azure SDK calls are synchronous inside async FastAPI handlers, blocking the event loop thread.

---

## 4. Documentation

The existing `README.md` is empty (3 blank lines). No setup guide, architecture overview, or feature description exists.

---

## Summary of Highest-Priority Issues

| Priority | Issue | Impact |
|---|---|---|
| P0 | No file size limit on upload | DoS / OOM crash |
| P0 | Dead service layer reads from non-existent local path | Confusion / future bugs |
| P1 | Health score validity/consistency dimensions are placeholders | Misleads users |
| P1 | No per-column diagnostic detail in health response | Limits actionability |
| P1 | No data quality visualizations | Core product gap |
| P1 | DataHealthView.tsx and FileInsightsView.tsx show hardcoded fake data | Broken UI |
| P2 | AI summary blocks insights response | Latency / reliability |
| P2 | No encoding fallback in files.py blob loader | Crashes on Latin-1 CSVs |
| P2 | Inactive tenant users can still access data | Auth gap |
| P3 | No caching of DataFrame or AI summary | Performance |
| P3 | No rate limiting on auth endpoints | Security |
