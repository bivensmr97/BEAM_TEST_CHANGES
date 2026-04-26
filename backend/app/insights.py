import io
import os
import re
import json
import math
from decimal import Decimal
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from openai import OpenAI
from fastapi import HTTPException
from azure.storage.blob import BlobServiceClient
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models import File, LLMPricing, LLMUsageEvent, User

settings = get_settings()

MAX_ROWS_FOR_CHARTS = 50_000
MAX_ROWS_LOAD       = 500_000
MAX_KPI_CARDS       = 5       # cap on KPI cards shown


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
    name = col.replace("_", " ").replace("-", " ")
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name)
    return name.strip().title()


# ---------------------------------------------------------------------------
# AI Summary
# ---------------------------------------------------------------------------

def _active_pricing(db: Session | None, model: str) -> tuple[Decimal, Decimal]:
    if db is not None:
        try:
            pricing = (
                db.query(LLMPricing)
                .filter(LLMPricing.model == model, LLMPricing.is_active == True)
                .order_by(LLMPricing.effective_at.desc())
                .first()
            )
            if pricing:
                return Decimal(pricing.input_price_per_1m), Decimal(pricing.output_price_per_1m)
        except Exception:
            pass

    input_price = settings.LLM_DEFAULT_INPUT_PRICE_PER_1M
    output_price = settings.LLM_DEFAULT_OUTPUT_PRICE_PER_1M
    return (
        Decimal(str(input_price or 0)),
        Decimal(str(output_price or 0)),
    )


def _estimate_cost(
    db: Session | None,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> Decimal:
    input_price, output_price = _active_pricing(db, model)
    return (
        (Decimal(prompt_tokens) / Decimal(1_000_000)) * input_price
        + (Decimal(completion_tokens) / Decimal(1_000_000)) * output_price
    ).quantize(Decimal("0.00000001"))


def _log_llm_usage(
    db: Session | None,
    tenant_id,
    user_id,
    file_id,
    operation: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    status: str = "success",
    error_message: str | None = None,
) -> None:
    if db is None or tenant_id is None:
        return

    try:
        event = LLMUsageEvent(
            tenant_id=tenant_id,
            user_id=user_id,
            file_id=file_id,
            operation=operation,
            model=model,
            prompt_tokens=int(prompt_tokens or 0),
            completion_tokens=int(completion_tokens or 0),
            total_tokens=int((prompt_tokens or 0) + (completion_tokens or 0)),
            estimated_cost=_estimate_cost(db, model, int(prompt_tokens or 0), int(completion_tokens or 0)),
            status=status,
            error_message=(error_message or None)[:1000] if error_message else None,
        )
        db.add(event)
        db.commit()
    except Exception:
        db.rollback()


def generate_ai_summary(
    df: pd.DataFrame,
    db: Session | None = None,
    user: User | None = None,
    file: File | None = None,
    operation: str = "ai_summary",
) -> str:
    API_KEY = os.getenv("OPENAI_API_KEY")
    model = settings.OPENAI_MODEL
    tenant_id = getattr(user, "tenant_id", None) or getattr(file, "tenant_id", None)
    user_id = getattr(user, "id", None)
    file_id = getattr(file, "id", None)

    if not API_KEY:
        _log_llm_usage(
            db,
            tenant_id,
            user_id,
            file_id,
            operation,
            model,
            status="skipped",
            error_message="OPENAI_API_KEY is not configured.",
        )
        return None

    try:
        client = OpenAI(api_key=API_KEY)
        sample = df.head(20).to_csv(index=False)
        col_info = ", ".join(f"{c} ({df[c].dtype})" for c in df.columns[:20])
        prompt = (
            "You are a data analyst helping a non-technical business owner understand their data. "
            "Write 2–3 plain English sentences summarizing the main patterns and any obvious quality issues. "
            "Avoid jargon. Focus on what a business owner would care about.\n\n"
            f"Columns: {col_info}\n\nSample rows:\n{sample}"
        )
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
        )
        usage = getattr(response, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        _log_llm_usage(
            db,
            tenant_id,
            user_id,
            file_id,
            operation,
            model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            status="success",
        )
        return response.choices[0].message.content.strip()
    except Exception as ex:
        _log_llm_usage(
            db,
            tenant_id,
            user_id,
            file_id,
            operation,
            model,
            status="error",
            error_message=str(ex),
        )
        return None


# ---------------------------------------------------------------------------
# Blob loader
# ---------------------------------------------------------------------------

def load_file_from_blob(blob_path: str, sheet_name: str | None = None) -> pd.DataFrame:
    try:
        blob_service = BlobServiceClient.from_connection_string(settings.AZURE_BLOB_CONNSTRING)
        container = blob_service.get_container_client(settings.BLOB_CONTAINER)
        data = container.get_blob_client(blob_path).download_blob().readall()

        path = blob_path.lower()
        if path.endswith(".csv"):
            try:
                df = pd.read_csv(io.BytesIO(data), nrows=MAX_ROWS_LOAD)
            except UnicodeDecodeError:
                df = pd.read_csv(io.BytesIO(data), encoding="latin-1", nrows=MAX_ROWS_LOAD)
        elif path.endswith(".xlsx") or path.endswith(".xls"):
            workbook = pd.ExcelFile(io.BytesIO(data))
            available = [str(name) for name in workbook.sheet_names]
            selected_sheet = sheet_name or (available[0] if available else None)
            if not selected_sheet:
                raise HTTPException(422, "This workbook does not contain any sheets.")
            if selected_sheet not in available:
                raise HTTPException(404, f"Worksheet '{selected_sheet}' was not found in this workbook.")
            df = pd.read_excel(workbook, sheet_name=selected_sheet)
            if len(df) > MAX_ROWS_LOAD:
                df = df.head(MAX_ROWS_LOAD)
        else:
            raise HTTPException(400, "Unsupported file type")

        return _clean_df(df)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Could not read your file: {e}")


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

def _is_id_like(col: str, s: pd.Series) -> bool:
    col_lower = col.lower()
    id_keywords = ("id", "index", "key", "code", "number", "num", "no", "seq", "ref")
    if any(
        col_lower == kw
        or col_lower.endswith(f"_{kw}")
        or col_lower.endswith(f" {kw}")
        for kw in id_keywords
    ):
        return True
    if pd.api.types.is_integer_dtype(s):
        non_null = s.dropna()
        if len(non_null) > 10 and non_null.nunique() == len(non_null):
            diffs = non_null.sort_values().diff().dropna()
            if (diffs == 1).mean() > 0.9:
                return True
    return False


def _col_variance_rank(df: pd.DataFrame, col: str) -> float:
    """Return a sortable score: higher = more 'interesting' numeric column."""
    s = df[col].dropna()
    if len(s) == 0:
        return 0.0
    std = float(s.std())
    mean = abs(float(s.mean())) or 1.0
    return std / mean  # coefficient of variation


def compute_kpis(df: pd.DataFrame) -> dict:
    kpis = {"Total Records": int(len(df))}

    numeric_cols = [
        c for c in df.select_dtypes(include=[np.number]).columns
        if not _is_id_like(c, df[c])
    ]

    # Rank by coefficient of variation (most variable first — more interesting)
    ranked = sorted(numeric_cols, key=lambda c: _col_variance_rank(df, c), reverse=True)

    for col in ranked[: MAX_KPI_CARDS - 1]:  # -1 because Total Records is already in
        mean_val = df[col].mean(skipna=True)
        if pd.notna(mean_val):
            kpis[f"Average {_friendly_col_name(col)}"] = round(float(mean_val), 2)

    return kpis


# ---------------------------------------------------------------------------
# Chart helpers
# ---------------------------------------------------------------------------

def safe_fig(fig) -> dict:
    return json.loads(fig.to_json())


def _pick_interesting_numeric_cols(df: pd.DataFrame, max_cols: int = 3) -> list:
    candidates = [c for c in df.select_dtypes(include=[np.number]).columns if not _is_id_like(c, df[c])]
    return candidates[:max_cols]


def _pick_interesting_cat_cols(df: pd.DataFrame, max_cols: int = 2) -> list:
    return [
        c for c in df.select_dtypes(include=["object"]).columns
        if 2 <= df[c].nunique(dropna=True) <= 50
    ][:max_cols]


def _detect_datetime_col(df: pd.DataFrame) -> str | None:
    """Return the name of the most likely date/time column, or None."""
    # First check native datetime dtypes
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            return col
    # Then try parsing object columns that look like dates
    date_pattern = re.compile(r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}$")
    for col in df.select_dtypes(include=["object"]).columns:
        sample = df[col].dropna().astype(str).head(100)
        if len(sample) == 0:
            continue
        match_rate = float(sample.str.match(date_pattern).mean())
        if match_rate > 0.8:
            try:
                parsed = pd.to_datetime(df[col], errors="coerce")
                if parsed.notna().mean() > 0.8:
                    return col
            except Exception:
                pass
    return None


def build_charts(df: pd.DataFrame) -> dict:
    charts = {}

    # -----------------------------------------------------------------------
    # 1. Missing Data by Field (always shown)
    # -----------------------------------------------------------------------
    null_rates = df.isna().mean()
    missing = null_rates[null_rates > 0].sort_values(ascending=False)

    if not missing.empty:
        display = missing.head(20)
        labels = [_friendly_col_name(c) for c in display.index]
        values = [round(v * 100, 1) for v in display.values]
        colors = ["#ef4444" if v > 20 else "#f59e0b" if v > 5 else "#22c55e" for v in values]
        fig = go.Figure(go.Bar(
            x=values, y=labels, orientation="h",
            marker_color=colors,
            text=[f"{v}%" for v in values], textposition="outside",
        ))
        fig.update_layout(
            title="Missing Information by Field (% of records empty)",
            xaxis_title="% of records with missing data",
            yaxis={"autorange": "reversed"},
            margin={"l": 10, "r": 50, "t": 50, "b": 40},
        )
        charts["missing_data_by_field"] = safe_fig(fig)
    else:
        labels = [_friendly_col_name(c) for c in df.columns[:15]]
        fig = go.Figure(go.Bar(
            x=[100] * len(labels), y=labels, orientation="h",
            marker_color="#22c55e",
            text=["100%"] * len(labels), textposition="outside",
        ))
        fig.update_layout(
            title="All Fields Complete — No Missing Data Found",
            xaxis_title="Completeness (%)",
            yaxis={"autorange": "reversed"},
            margin={"l": 10, "r": 50, "t": 50, "b": 40},
        )
        charts["missing_data_by_field"] = safe_fig(fig)

    # -----------------------------------------------------------------------
    # 2. Time-series chart (if a date column is detected)
    # -----------------------------------------------------------------------
    date_col = _detect_datetime_col(df)
    numeric_for_ts = _pick_interesting_numeric_cols(df, max_cols=1)

    if date_col and numeric_for_ts:
        val_col = numeric_for_ts[0]
        try:
            ts_df = df[[date_col, val_col]].copy()
            ts_df[date_col] = pd.to_datetime(ts_df[date_col], errors="coerce")
            ts_df = ts_df.dropna()
            ts_df = ts_df.sort_values(date_col)

            # Resample to a sensible frequency if many rows
            if len(ts_df) > 365:
                ts_df = ts_df.set_index(date_col).resample("ME")[val_col].mean().reset_index()
                freq_label = "Monthly average"
            elif len(ts_df) > 90:
                ts_df = ts_df.set_index(date_col).resample("W")[val_col].mean().reset_index()
                freq_label = "Weekly average"
            else:
                freq_label = "Daily"

            friendly_val = _friendly_col_name(val_col)
            friendly_date = _friendly_col_name(date_col)

            fig = px.line(
                ts_df, x=date_col, y=val_col,
                title=f"{friendly_val} Over Time ({freq_label})",
                labels={date_col: friendly_date, val_col: friendly_val},
                color_discrete_sequence=["#06b6d4"],
            )
            fig.update_layout(
                xaxis_title=friendly_date,
                yaxis_title=friendly_val,
                margin={"l": 10, "r": 10, "t": 50, "b": 40},
            )
            charts[f"timeseries_{val_col}"] = safe_fig(fig)
        except Exception:
            pass  # Time series failed silently — fall through to histograms

    # -----------------------------------------------------------------------
    # 3. Distribution of key numeric columns (skip if time-series was built)
    # -----------------------------------------------------------------------
    if date_col and f"timeseries_{numeric_for_ts[0]}" in charts if numeric_for_ts else False:
        # Already have a time-series for the first numeric col; histogram remaining ones
        remaining = _pick_interesting_numeric_cols(df, max_cols=4)[1:]
    else:
        remaining = _pick_interesting_numeric_cols(df, max_cols=3)

    for i, col in enumerate(remaining):
        dff = df[col].dropna()
        if len(dff) == 0:
            continue

        friendly = _friendly_col_name(col)

        # Clip display at 99th percentile to avoid extreme skew compressing the chart
        p99 = float(dff.quantile(0.99))
        clipped = dff[dff <= p99]
        note = f" (values above {p99:,.1f} not shown)" if len(clipped) < len(dff) else ""

        fig = px.histogram(
            clipped.to_frame(), x=col, nbins=30,
            title=f"Distribution of {friendly}{note}",
            labels={col: friendly, "count": "Number of Records"},
            color_discrete_sequence=["#06b6d4"],
        )
        fig.update_layout(
            xaxis_title=friendly,
            yaxis_title="Number of Records",
            margin={"l": 10, "r": 10, "t": 50, "b": 40},
        )
        charts[f"distribution_{i + 1}_{col}"] = safe_fig(fig)

    # -----------------------------------------------------------------------
    # 4. Top categories for categorical columns (up to 2)
    # -----------------------------------------------------------------------
    for i, col in enumerate(_pick_interesting_cat_cols(df, max_cols=2)):
        counts = df[col].dropna().value_counts().head(15).reset_index()
        counts.columns = [col, "count"]
        if counts.empty:
            continue
        friendly = _friendly_col_name(col)
        fig = px.bar(
            counts, x=col, y="count",
            title=f"Record Count by {friendly}",
            labels={col: friendly, "count": "Number of Records"},
            color_discrete_sequence=["#06b6d4"],
        )
        fig.update_layout(
            xaxis_title=friendly,
            yaxis_title="Number of Records",
            xaxis_tickangle=-30,
            margin={"l": 10, "r": 10, "t": 50, "b": 80},
        )
        charts[f"breakdown_{i + 1}_{col}"] = safe_fig(fig)

    return charts


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def extract_filters(df: pd.DataFrame) -> dict:
    return {
        col: sorted(df[col].dropna().unique().tolist())
        for col in df.select_dtypes(include=["object"]).columns
        if 2 <= df[col].nunique(dropna=True) <= 50
    }


def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    filtered = df.copy()
    for key, val in (filters or {}).items():
        if key not in filtered.columns or val in [None, "", "all"]:
            continue
        filtered = filtered[filtered[key] == val]
    return filtered


# ---------------------------------------------------------------------------
# Full insights pipeline
# ---------------------------------------------------------------------------

def generate_insights(
    blob_path: str,
    filters: dict = None,
    sheet_name: str | None = None,
    db: Session | None = None,
    user: User | None = None,
    file: File | None = None,
) -> dict:
    df = load_file_from_blob(blob_path, sheet_name=sheet_name)

    if filters:
        df = apply_filters(df, filters)

    df_for_charts = df.head(MAX_ROWS_FOR_CHARTS)

    result = {
        "kpis":      compute_kpis(df),
        "charts":    build_charts(df_for_charts),
        "filters":   extract_filters(df),
        "ai_summary": generate_ai_summary(
            df_for_charts,
            db=db,
            user=user,
            file=file,
            operation="file_overview_ai_summary",
        ),
        "debug": {
            "version":              "insights_py_2026-04-03_v4",
            "rows":                 int(df.shape[0]),
            "cols":                 int(df.shape[1]),
            "rows_used_for_charts": int(df_for_charts.shape[0]),
        },
    }

    return _json_safe(result)
