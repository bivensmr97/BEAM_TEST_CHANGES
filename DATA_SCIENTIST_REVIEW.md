# Data Scientist Review — BEAM Analytics

**Reviewer role:** Data scientist / analyst evaluating this as a first-step data quality and exploration tool  
**Date:** 2026-04-03 (v2 pass)

---

## Executive Summary

The tool provides a solid first-pass quality check for non-technical audiences. From a data science standpoint it is useful as a "quick-scan" layer but lacks the depth and flexibility needed for analytical work. The primary gaps are: limited distribution statistics, no time-series awareness, an over-aggressive outlier penalty that misfires on legitimate skewed data, and no correlation / relationship view. These are addressable without adding complexity for business users — the extra depth can live in the field-by-field table and a collapsed "Advanced" section.

---

## 1. Statistical Validity

### What is correct
- **IQR-based outlier detection** (Tukey fences at Q1 − 1.5×IQR, Q3 + 1.5×IQR) — industry standard, appropriate choice. Better than the previous 3-sigma method.
- **Weighted health score** — weighting completeness and uniqueness higher than validity/distribution is a defensible choice.
- **Null rate computation** — `df.isna().mean()` is correct; NaN, None, and pandas NA are all caught.
- **Duplicate detection** — `df.duplicated(keep=False)` correctly counts all copies of a duplicate record.

### Issues

**Issue 1 — Outlier penalty is over-aggressive for real-world business data**  
`distribution_score = 100 - (outlier_rate × 300)` means a 0.33% outlier rate produces a score of 0. By the IQR definition, a normal distribution has ~7% of values outside the fences, and heavy-tailed distributions common in business data (revenue, claim amounts, transaction sizes) routinely have 10–20% of values beyond Q1−1.5×IQR. This makes the score artificially low for perfectly clean financial or operations datasets.

**Recommendation:** Reduce the multiplier to 100 (so 100% outlier rate → score 0), and note that the outlier check is informational rather than a major quality dimension.

**Issue 2 — Per-column stats missing p25 and p75**  
`ColumnHealthDetail` returns min, max, mean, median, std. Missing: 25th and 75th percentiles (the IQR endpoints that drive the outlier detection). These are the most useful numbers for understanding the "normal range" of a column without being distorted by extremes.

**Recommendation:** Add `pct_25` and `pct_75` to `ColumnHealthDetail`.

**Issue 3 — No skewness statistic**  
Skewness is essential for understanding whether mean or median is the better summary statistic for a column, and whether outlier detection based on symmetric methods (IQR) is appropriate. Highly skewed columns (e.g., log-normal distributions) will always flag many outliers using Tukey fences.

**Recommendation:** Add `skewness` (pandas `Series.skew()`) to `ColumnHealthDetail` for numeric columns.

**Issue 4 — `infer_datetime_format=True` is deprecated in pandas 2.0**  
The validity check uses:
```python
parsed = pd.to_datetime(sample, errors="coerce", infer_datetime_format=True)
```
This raises a `FutureWarning` in pandas 2.0 and is a no-op in pandas 2.2+. The argument should be removed.

**Issue 5 — No cardinality classification**  
Columns are labeled "numeric", "datetime", or "text". A data scientist also needs to know:
- **Constant**: all values identical (useless for analysis)
- **Near-unique**: almost every value is different (likely an ID or free-text — don't aggregate)
- **Binary**: only 2 distinct values (candidate for boolean encoding)
- **Low-cardinality**: 3–20 distinct values (candidate for groupby analysis)

These classifications guide downstream decisions. They're currently not surfaced.

**Recommendation:** Add a `cardinality_class` field to `ColumnHealthDetail`.

---

## 2. Flexibility Across User Types

### Data scientist needs not yet served

**Issue 6 — No time-series awareness**  
If the dataset contains a recognized datetime column, the most useful chart for a data scientist (and most business users) is a time-series of key numeric values over time. Currently, datetime columns are identified in `_load_dataframe_from_blob()` but never used for chart selection.

A date column + a numeric column = a trend chart. This should be auto-detected.

**Recommendation:** In `build_charts()`, detect datetime-parseable columns and if one exists, add a time-series line chart for the most important numeric column.

**Issue 7 — KPI cards show only averages**  
Averages are misleading for skewed data. Showing median alongside mean, or min/max range, would be more useful. At minimum, a tooltip explaining "this is the average across all records" would set proper expectations.

**Issue 8 — No way to see which columns are correlated**  
The correlation heatmap was removed from the default charts (correct for business users). But a data scientist reviewing data quality wants to know if two columns are near-perfectly correlated (suggests redundancy) or negatively correlated (suggests a possible data entry issue). 

**Recommendation:** Add a correlation note to the column detail: for any two numeric columns with |correlation| > 0.95, flag them as "strongly related to [other column]" in the detail table.

**Issue 9 — Constant columns are not flagged**  
A column where every value is identical contributes nothing to analysis and may indicate a broken data feed (e.g., a status column that should vary but doesn't). This is a validity/quality signal worth calling out.

---

## 3. Chart Quality

**Issue 10 — Histograms use fixed 30 bins**  
30 bins works well for approximately normally distributed data. For very skewed distributions (e.g., sales data with 90% of values under $100 and 1% over $10,000), most of the information is compressed into 1–2 bins on the left, and the chart appears nearly useless.

**Recommendation:** Use `nbins="auto"` (Sturges/Freedman-Diaconis) or cap the upper end at the 99th percentile for the histogram display, and note the actual max.

**Issue 11 — Chart for categorical columns uses raw column name as x-axis when values are truncated**  
Long categorical values (e.g., full product names, addresses) are truncated in the bar chart x-axis without clear indication. Consider rotating labels or trimming to 20 characters with "…" suffix.

**Issue 12 — No empty-state chart message**  
When a dataset has no numeric columns (e.g., a pure text/categorical file), the charts section shows only the missing-data chart with no explanation. Should show a message: "No numeric columns — distribution charts not available for this dataset."

---

## 4. Scoring Calibration

Current weights:
- Completeness: 35%
- Uniqueness: 30%  
- Validity: 20%
- Distribution: 15%

**Assessment:** These weights are reasonable for a business data quality use case. However:

1. The `completeness_score` uses `100 - (null_rate × 200)` which means 50% null rate → score 0. In some legitimate datasets (survey data, optional fields), 30–50% null rates are expected and not a quality problem. A column that is *intended* to be optional should not collapse the score.

2. The `uniqueness_score` uses a 300× multiplier. A 0.33% duplicate rate → score 0. For large transactional datasets, a small number of duplicates from system retries is expected and not a serious problem.

**Recommendation:** Soften both multipliers (200 → 150 for completeness, 300 → 150 for uniqueness) so that small rates cause proportional but not catastrophic score drops. This makes the score more calibrated to real-world data.

---

## 5. What Works Well

- The completeness chart ("Missing Information by Field") is genuinely useful — it's the right first chart for a data quality tool.
- The IQR outlier method is statistically appropriate.
- The per-column detail table gives data scientists the raw numbers needed for deeper investigation.
- The `_is_id_like()` heuristic correctly excludes sequential ID columns from KPI averages.
- The `_pick_interesting_cat_cols()` cardinality filter (2–50 unique values) correctly excludes free-text columns from bar charts.
- The `_json_safe()` sanitization prevents NaN/Inf from crashing the API response.

---

## Priority Fixes for This Pass

| Priority | Issue | Effort |
|---|---|---|
| P1 | Add `pct_25`, `pct_75`, `skewness` to column stats | Low |
| P1 | Add `cardinality_class` to column detail | Low |
| P1 | Fix `infer_datetime_format=True` deprecation | Trivial |
| P1 | Soften outlier and uniqueness score multipliers | Trivial |
| P2 | Auto-detect datetime column for time-series chart | Medium |
| P2 | Flag constant columns as a quality issue | Low |
| P3 | Smarter histogram binning / clip at p99 | Low |
