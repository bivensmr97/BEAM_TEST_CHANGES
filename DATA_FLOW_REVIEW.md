# Data Flow & Database Wiring Review

**Date:** 2026-04-03 (v2 pass)  
**Scope:** Verify every data path from browser → API → database → blob storage → response

---

## 1. Data Path Map

| User Action | Frontend Call | Auth Check | DB Lookup | Blob Op | Returns |
|---|---|---|---|---|---|
| List files | GET /api/files/ | JWT → tenant_id | Files WHERE tenant_id = ? | None | File metadata array |
| Upload | POST /api/files/upload | JWT → tenant_id | INSERT into files | PUT blob | FileOut |
| Download | GET /api/files/{id}/download/ | JWT + tenant match | SELECT by id+tenant_id | GET blob → stream | Raw file bytes |
| File Overview (charts/KPIs) | POST /api/files/{id}/insights | JWT + tenant match | SELECT by id+tenant_id | GET blob → parse | Charts + KPIs JSON |
| Data Health | POST /api/files/{id}/health | JWT + tenant match | SELECT by id+tenant_id | GET blob → parse | Health diagnostic JSON |
| AI Summary | POST /api/files/{id}/ai-summary | JWT + tenant match | SELECT by id+tenant_id | GET blob → parse | AI text |

**Verdict: All endpoints correctly query the DB using `file.blob_path` (stored at upload time) and load from Azure Blob, with tenant isolation enforced on every path.**

---

## 2. Confirmed Working

- **Tenant isolation**: Every file query filters `File.tenant_id == user.tenant_id` where `tenant_id` comes from the validated JWT. No cross-tenant access is possible.
- **Blob path construction**: At upload, paths are `tenant_{tenant_id}/file_{file_id}/raw/{filename}`. This namespace is consistent across upload, download, and all analysis endpoints.
- **Encoding resilience**: `insights.py::load_file_from_blob()` falls back to Latin-1 on `UnicodeDecodeError`. `files.py::_load_dataframe_from_blob()` now also includes this fallback (added in v1 review).
- **Type handling**: Both loaders call `_clean_df()` / inline cleanup to strip fully-empty rows/columns and replace infinities with NaN before returning.

---

## 3. Issues Found

### Issue A — No row cap on `_load_dataframe_from_blob` in `files.py`
`insights.py::load_file_from_blob()` caps CSV reads at `nrows=MAX_ROWS_LOAD (500k)`.  
`files.py::_load_dataframe_from_blob()` has **no row cap**. The `file_health` endpoint uses this function. A 2 million row CSV would be loaded entirely into container memory before any analysis runs.

**Fix:** Add the same 500k cap to `_load_dataframe_from_blob()`.

### Issue B — File name not displayed on the analysis page
The file detail page (`/dashboard/file/[id]/page.tsx`) shows "File Analysis" as the page title and the raw UUID below it. The actual file name is never fetched or shown. A user doesn't know which file they are analyzing without scrolling back to the sidebar.

The file name is available via `GET /api/files/{id}` (returns `FileOut` with `original_name`). This call should be made once on page load and the name used in the header.

**Fix:** Add a `useEffect` to fetch `GET /api/files/{id}` on mount and display `original_name` in the header.

### Issue C — Health tab re-fetches on every tab switch
`HealthDiagnosticView` calls `fetchHealth()` inside a `useEffect([fileId, token])`. Every time the user switches from "File Overview" to "Data Health", the component mounts fresh (because of conditional rendering with `activeTab === "health"`) and kicks off a new full analysis.

For a 50 MB file this means a full blob download + pandas parse + outlier detection on every tab visit.

**Fix:** Lift `health` state up to the parent `page.tsx` so results are cached for the session. Pass cached data down as a prop; only fetch on first visit.

### Issue D — Stub filter presets still do nothing
`FilterPanel.tsx` has three preset buttons ("High-Value Records", "Missing Data Check", "Outliers") that call `onApplyPreset(preset)`. The parent `page.tsx` logs to console but applies no filters. These buttons appear functional but do nothing — a trust-eroding experience.

**Fix:** Either remove the preset buttons entirely, or implement them (e.g., "Missing Data Check" could sort the filter panel to highlight columns with high null rates). For now, remove them to avoid the dead-end UX.

### Issue E — KPI cards are unbounded
`compute_kpis()` generates one card per non-ID numeric column. A 25-column dataset with 12 numeric columns (after ID exclusion) shows 12 KPI cards. This is overwhelming and most of the averages are not meaningful at a glance.

**Fix:** Cap KPI card output at 5 (Total Records + 4 most-variance numeric columns).

---

## 4. Verified Correct Paths

| Path | Assessment |
|---|---|
| insights_routes.py POST /insights → insights.py::generate_insights(file.blob_path) | Correct — blob_path from DB |
| files.py POST /health → _load_dataframe_from_blob(file) | Correct — uses file object from DB |
| files.py GET /download → container_client.get_blob_client(file.blob_path) | Correct |
| auth.py get_current_user → DB query for User by JWT sub | Correct |
| All file queries include FileModel.tenant_id == user.tenant_id | Confirmed correct |
