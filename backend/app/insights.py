import io
import os
import json
import math
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from openai import OpenAI
from fastapi import HTTPException
from azure.storage.blob import BlobServiceClient
from app.config import get_settings

settings = get_settings()

# Maximum rows sent to chart-building functions (prevents memory/timeout issues)
MAX_ROWS_FOR_CHARTS = 50_000
# Maximum rows loaded from blob (guard against enormous files)
MAX_ROWS_LOAD = 500_000


# -------------------------
# Helpers: make payload JSON-safe
# -------------------------
def _clean_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.dropna(how="all")
    df = df.dropna(axis=1, how="all")
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _json_safe(obj):
    """Recursively convert NaN/Inf to None so FastAPI JSON encoding never fails."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    return obj


def _friendly_col_name(col: str) -> str:
    """Convert snake_case or CamelCase column names to friendly Title Case."""
    # Replace underscores/hyphens with spaces then title-case
    name = col.replace("_", " ").replace("-", " ")
    # Insert space before capital letters in CamelCase
    import re
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    return name.strip().title()


# -------------------------
# AI Summary (non-blocking wrapper)
# -------------------------
def generate_ai_summary(df: pd.DataFrame) -> str:
    API_KEY = os.getenv("OPENAI_API_KEY")
    if not API_KEY:
        return None  # Caller will omit the field rather than showing an error message

    try:
        client = OpenAI(api_key=API_KEY)

        # Use a compact sample to minimise token cost
        sample = df.head(20).to_csv(index=False)
        col_info = ", ".join(
            f"{c} ({df[c].dtype})" for c in df.columns[:20]
        )
        prompt = (
            "You are a data analyst helping a non-technical business owner understand their data. "
            "Write 2-3 plain English sentences summarising the main patterns and any obvious quality issues "
            "in the dataset below. Avoid jargon. Focus on what a business owner would care about.\n\n"
            f"Columns: {col_info}\n\n"
            f"Sample rows:\n{sample}"
        )

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        return response.choices[0].message.content.strip()

    except Exception:
        return None


# -------------------------
# Load file from Azure Blob
# -------------------------
def load_file_from_blob(blob_path: str) -> pd.DataFrame:
    try:
        blob_service = BlobServiceClient.from_connection_string(
            settings.AZURE_BLOB_CONNSTRING
        )
        container = blob_service.get_container_client(settings.BLOB_CONTAINER)

        blob = container.get_blob_client(blob_path)
        data = blob.download_blob().readall()

        path = blob_path.lower()

        if path.endswith(".csv"):
            try:
                df = pd.read_csv(io.BytesIO(data), nrows=MAX_ROWS_LOAD)
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(data), encoding="latin-1", nrows=MAX_ROWS_LOAD)
        elif path.endswith(".xlsx") or path.endswith(".xls"):
            df = pd.read_excel(io.BytesIO(data))
            if len(df) > MAX_ROWS_LOAD:
                df = df.head(MAX_ROWS_LOAD)
        else:
            raise HTTPException(400, "Unsupported file type")

        return _clean_df(df)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not read your file: {e}")


# -------------------------
# Compute KPIs
# -------------------------
def _is_id_like(col: str, s: pd.Series) -> bool:
    """Heuristic: returns True if a column looks like an ID/index (skip averaging)."""
    col_lower = col.lower()
    id_keywords = ("id", "index", "key", "code", "number", "num", "no", "seq", "ref")
    if any(col_lower == kw or col_lower.endswith(f"_{kw}") or col_lower.endswith(f" {kw}")
           for kw in id_keywords):
        return True
    # If all values are sequential integers, it's likely an index
    if pd.api.types.is_integer_dtype(s):
        non_null = s.dropna()
        if len(non_null) > 10 and non_null.nunique() == len(non_null):
            diffs = non_null.sort_values().diff().dropna()
            if (diffs == 1).mean() > 0.9:
                return True
    return False


def compute_kpis(df: pd.DataFrame) -> dict:
    kpis = {"Total Records": int(len(df))}

    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        if _is_id_like(col, df[col]):
            continue
        mean_val = df[col].mean(skipna=True)
        if pd.notna(mean_val):
            kpis[f"Average {_friendly_col_name(col)}"] = round(float(mean_val), 2)

    return kpis


# -------------------------
# Build Charts
# -------------------------
def safe_fig(fig) -> dict:
    return json.loads(fig.to_json())


def _pick_interesting_numeric_cols(df: pd.DataFrame, max_cols: int = 3) -> list:
    """Return up to max_cols numeric columns that are not ID-like."""
    candidates = []
    for col in df.select_dtypes(include=[np.number]).columns:
        if not _is_id_like(col, df[col]):
            candidates.append(col)
        if len(candidates) >= max_cols:
            break
    return candidates


def _pick_interesting_cat_cols(df: pd.DataFrame, max_cols: int = 2) -> list:
    """Return up to max_cols categorical columns with useful cardinality (2–50 unique values)."""
    candidates = []
    for col in df.select_dtypes(include=["object"]).columns:
        n_unique = df[col].nunique(dropna=True)
        if 2 <= n_unique <= 50:
            candidates.append(col)
        if len(candidates) >= max_cols:
            break
    return candidates


def build_charts(df: pd.DataFrame) -> dict:
    charts = {}

    # --- 1. Missing Data by Field ---
    null_rates = df.isna().mean()
    # Only show columns that have at least some missing data, sorted worst-first
    missing = null_rates[null_rates > 0].sort_values(ascending=False)
    if not missing.empty:
        # If all columns are complete, still show top-10 with 0% so user can see the clean state
        display = missing.head(20) if not missing.empty else null_rates.head(20)
        labels = [_friendly_col_name(c) for c in display.index]
        values = [round(v * 100, 1) for v in display.values]
        colors = ["#ef4444" if v > 20 else "#f59e0b" if v > 5 else "#22c55e" for v in values]

        fig = go.Figure(go.Bar(
            x=values,
            y=labels,
            orientation="h",
            marker_color=colors,
            text=[f"{v}%" for v in values],
            textposition="outside",
        ))
        fig.update_layout(
            title="Missing Information by Field (% of records empty)",
            xaxis_title="Percentage of records with missing data",
            yaxis_title=None,
            yaxis={"autorange": "reversed"},
            margin={"l": 10, "r": 40, "t": 50, "b": 40},
        )
        charts["missing_data_by_field"] = safe_fig(fig)
    else:
        # All complete — show a clean summary chart
        labels = [_friendly_col_name(c) for c in df.columns[:15]]
        fig = go.Figure(go.Bar(
            x=[100] * len(labels),
            y=labels,
            orientation="h",
            marker_color="#22c55e",
            text=["100%"] * len(labels),
            textposition="outside",
        ))
        fig.update_layout(
            title="Missing Information by Field — All Fields Complete!",
            xaxis_title="Completeness (%)",
            yaxis={"autorange": "reversed"},
            margin={"l": 10, "r": 40, "t": 50, "b": 40},
        )
        charts["missing_data_by_field"] = safe_fig(fig)

    # --- 2. Distribution of key numeric columns (up to 3) ---
    numeric_interest = _pick_interesting_numeric_cols(df, max_cols=3)
    for i, col in enumerate(numeric_interest):
        dff = df[col].dropna()
        if len(dff) == 0:
            continue
        friendly = _friendly_col_name(col)
        fig = px.histogram(
            dff.to_frame(),
            x=col,
            nbins=30,
            title=f"Distribution of {friendly}",
            labels={col: friendly, "count": "Number of Records"},
            color_discrete_sequence=["#06b6d4"],
        )
        fig.update_layout(
            xaxis_title=friendly,
            yaxis_title="Number of Records",
            margin={"l": 10, "r": 10, "t": 50, "b": 40},
        )
        charts[f"distribution_{i + 1}_{col}"] = safe_fig(fig)

    # --- 3. Top categories for categorical columns (up to 2) ---
    cat_interest = _pick_interesting_cat_cols(df, max_cols=2)
    for i, col in enumerate(cat_interest):
        counts = df[col].dropna().value_counts().head(15).reset_index()
        counts.columns = [col, "count"]
        if counts.empty:
            continue
        friendly = _friendly_col_name(col)
        fig = px.bar(
            counts,
            x=col,
            y="count",
            title=f"Record Count by {friendly}",
            labels={col: friendly, "count": "Number of Records"},
            color_discrete_sequence=["#06b6d4"],
        )
        fig.update_layout(
            xaxis_title=friendly,
            yaxis_title="Number of Records",
            margin={"l": 10, "r": 10, "t": 50, "b": 60},
        )
        charts[f"breakdown_{i + 1}_{col}"] = safe_fig(fig)

    return charts


# -------------------------
# Extract Filters
# -------------------------
def extract_filters(df: pd.DataFrame) -> dict:
    filters = {}
    for col in df.select_dtypes(include=["object"]).columns:
        unique_vals = sorted(df[col].dropna().unique().tolist())
        if 2 <= len(unique_vals) <= 50:
            filters[col] = unique_vals
    return filters


# -------------------------
# Apply Filters
# -------------------------
def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    filtered_df = df.copy()
    for key, val in (filters or {}).items():
        if key not in filtered_df.columns:
            continue
        if val in [None, "", "all"]:
            continue
        filtered_df = filtered_df[filtered_df[key] == val]
    return filtered_df


# -------------------------
# Full Insights Pipeline
# -------------------------
def generate_insights(blob_path: str, filters: dict = None) -> dict:
    df = load_file_from_blob(blob_path)

    if filters:
        df = apply_filters(df, filters)

    df_for_charts = df.head(MAX_ROWS_FOR_CHARTS)

    # AI summary is optional — omit rather than blocking on failure
    ai_summary = generate_ai_summary(df_for_charts)

    result = {
        "kpis": compute_kpis(df),
        "charts": build_charts(df_for_charts),
        "filters": extract_filters(df),
        "ai_summary": ai_summary,
        "debug": {
            "version": "insights_py_2026-04-03_v3",
            "rows": int(df.shape[0]),
            "cols": int(df.shape[1]),
            "rows_used_for_charts": int(df_for_charts.shape[0]),
        },
    }

    return _json_safe(result)
