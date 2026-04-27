# backend/app/routers/files.py
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from uuid import uuid4, UUID
from datetime import datetime
import re
import math
import io
import json as _json
import pandas as pd
import numpy as np
import plotly.express as px
from urllib.parse import quote

from azure.storage.blob import BlobServiceClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_db
from app.auth import get_current_user
from app.models import File as FileModel, User

router = APIRouter()

settings = get_settings()
blob_service = BlobServiceClient.from_connection_string(settings.AZURE_BLOB_CONNSTRING)
container_client = blob_service.get_container_client(settings.BLOB_CONTAINER)

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------
MAX_UPLOAD_BYTES = 50 * 1024 * 1024   # 50 MB
MAX_ROWS_LOAD    = 500_000             # rows cap on blob reads


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class FileOut(BaseModel):
    id: UUID
    original_name: str
    uploaded_at: datetime
    status: str
    size_bytes: int | None
    workbook: Optional[Dict[str, Any]] = None

    class Config:
        orm_mode = True


class TopValue(BaseModel):
    value: str
    count: int


class ColumnInsight(BaseModel):
    name: str
    inferred_type: str
    null_rate: float
    distinct_count: int
    top_values: list[TopValue] = []


class InsightsOut(BaseModel):
    summary: str
    columns: list[ColumnInsight]


class IssueOut(BaseModel):
    key: str
    severity: str          # "critical" | "warning" | "info"
    title: str
    plain_message: str
    recommendation: str


class ColumnHealthDetail(BaseModel):
    name: str
    null_rate: float
    null_count: int
    distinct_count: int
    total_count: int
    inferred_type: str
    cardinality_class: str        # constant | binary | low | medium | high | unique
    # numeric stats (None for non-numeric columns)
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    mean_value: Optional[float] = None
    median_value: Optional[float] = None
    std_dev: Optional[float] = None
    pct_25: Optional[float] = None
    pct_75: Optional[float] = None
    skewness: Optional[float] = None
    outlier_count: Optional[int] = None
    # top values for text/categorical columns
    top_values: list[TopValue] = []


class HealthOut(BaseModel):
    score: float
    grade: str
    score_label: str
    category_scores: Dict[str, float]
    category_labels: Dict[str, str]
    scoring_explanation: Dict[str, str]   # one-line explanation per dimension
    issues: list[IssueOut]
    column_details: list[ColumnHealthDetail]
    total_rows: int
    total_columns: int
    duplicate_count: int


class HealthIn(BaseModel):
    yaml_config: Optional[str] = None
    sheet_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _content_disposition_attachment(filename: str) -> str:
    name = filename or "download"
    name = re.sub(r"[\r\n]", " ", name).replace('"', "")
    fallback = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip() or "download"
    encoded = quote(name, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _extract_workbook_metadata(filename: str, data: bytes) -> Optional[Dict[str, Any]]:
    name_lc = (filename or "").lower()
    if not (name_lc.endswith(".xlsx") or name_lc.endswith(".xls")):
        return None

    try:
        workbook = pd.ExcelFile(io.BytesIO(data))
        sheet_names = [str(name) for name in workbook.sheet_names]
        if not sheet_names:
            return None
        return {
            "sheet_names": sheet_names,
            "sheet_count": len(sheet_names),
            "default_sheet": sheet_names[0],
        }
    except Exception:
        return None


def _file_out_with_workbook(file: FileModel) -> FileOut:
    workbook = None
    try:
        data = container_client.get_blob_client(file.blob_path).download_blob().readall()
        workbook = _extract_workbook_metadata(file.original_name, data)
    except Exception:
        workbook = None

    return FileOut(
        id=file.id,
        original_name=file.original_name,
        uploaded_at=file.uploaded_at,
        status=file.status,
        size_bytes=file.size_bytes,
        workbook=workbook,
    )


def _load_dataframe_from_blob(file: FileModel, sheet_name: Optional[str] = None) -> pd.DataFrame:
    """Download a file from Azure Blob and parse into a DataFrame.

    - Applies a 500k row cap to prevent OOM on huge files
    - Falls back to Latin-1 encoding if UTF-8 fails
    - Strips fully-empty rows/columns common in Excel exports
    """
    blob_client = container_client.get_blob_client(file.blob_path)
    data = blob_client.download_blob().readall()

    name_lc = (file.original_name or "").lower()
    if name_lc.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(data), nrows=MAX_ROWS_LOAD)
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(data), encoding="latin-1", nrows=MAX_ROWS_LOAD)
    elif name_lc.endswith(".xlsx") or name_lc.endswith(".xls"):
        try:
            workbook = pd.ExcelFile(io.BytesIO(data))
            available = [str(name) for name in workbook.sheet_names]
            selected_sheet = sheet_name or (available[0] if available else None)
            if not selected_sheet:
                raise HTTPException(status_code=422, detail="This workbook does not contain any sheets.")
            if selected_sheet not in available:
                raise HTTPException(
                    status_code=404,
                    detail=f"Worksheet '{selected_sheet}' was not found in this workbook.",
                )
            df = pd.read_excel(workbook, sheet_name=selected_sheet)
        except HTTPException:
            raise
        except Exception as ex:
            raise HTTPException(status_code=400, detail=f"Could not read Excel workbook: {ex}")
        if len(df) > MAX_ROWS_LOAD:
            df = df.head(MAX_ROWS_LOAD)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type for parsing")

    df = df.dropna(how="all").dropna(axis=1, how="all")
    df.columns = [str(c).strip() for c in df.columns]
    df = df.replace([np.inf, -np.inf], np.nan)
    return df


def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    except (TypeError, ValueError):
        return None


def _cardinality_class(n_distinct: int, n_rows: int) -> str:
    if n_distinct <= 1:
        return "constant"
    if n_distinct == 2:
        return "binary"
    if n_distinct <= 20:
        return "low"
    ratio = n_distinct / max(1, n_rows)
    if ratio > 0.95:
        return "unique"
    if n_distinct <= 100:
        return "medium"
    return "high"


def _score_label(score: float) -> str:
    if score >= 90:
        return "Excellent — your data is in great shape"
    if score >= 80:
        return "Good — minor issues worth reviewing"
    if score >= 70:
        return "Fair — several issues that should be addressed"
    if score >= 60:
        return "Poor — significant data problems found"
    return "Critical — urgent data quality issues require attention"


def _grade(score: float) -> str:
    if score >= 90: return "A"
    if score >= 80: return "B"
    if score >= 70: return "C"
    if score >= 60: return "D"
    return "F"


# ---------------------------------------------------------------------------
# Upload / list / get / download
# ---------------------------------------------------------------------------

@router.post("/upload", response_model=FileOut)
async def upload_file(
    uploaded_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if uploaded_file.content_type not in (
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ):
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a CSV or Excel file.")

    data = await uploaded_file.read()

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. Maximum upload size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    file_id = str(uuid4())
    blob_path = f"tenant_{user.tenant_id}/file_{file_id}/raw/{uploaded_file.filename}"

    try:
        container_client.get_blob_client(blob_path).upload_blob(data, overwrite=True)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Upload failed: {ex}")

    db_file = FileModel(
        id=file_id,
        tenant_id=user.tenant_id,
        uploaded_by=user.id,
        original_name=uploaded_file.filename,
        blob_path=blob_path,
        file_type="csv" if uploaded_file.filename.lower().endswith(".csv") else "xlsx",
        size_bytes=len(data),
        status="uploaded",
        uploaded_at=datetime.utcnow(),
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    return db_file


@router.get("/", response_model=List[FileOut])
def list_files(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(FileModel)
        .filter(FileModel.tenant_id == user.tenant_id)
        .order_by(FileModel.uploaded_at.desc())
        .all()
    )


@router.get("/{file_id}", response_model=FileOut)
def get_file(file_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return _file_out_with_workbook(file)


@router.get("/{file_id}/download")
@router.get("/{file_id}/download/")
def download_file(file_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    try:
        downloader = container_client.get_blob_client(file.blob_path).download_blob()

        def stream():
            for chunk in downloader.chunks():
                yield chunk

        name_lc = (file.original_name or "").lower()
        media_type = (
            "text/csv" if name_lc.endswith(".csv")
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if name_lc.endswith(".xlsx")
            else "application/vnd.ms-excel" if name_lc.endswith(".xls")
            else "application/octet-stream"
        )
        headers = {"Content-Disposition": _content_disposition_attachment(file.original_name)}
        return StreamingResponse(stream(), media_type=media_type, headers=headers)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Download failed: {ex}")


# ---------------------------------------------------------------------------
# GET /insights — lightweight column profile
# ---------------------------------------------------------------------------

@router.get("/{file_id}/insights", response_model=InsightsOut)
def file_insights(
    file_id: str,
    sheet_name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    df = _load_dataframe_from_blob(file, sheet_name=sheet_name)
    cols = []
    for c in df.columns:
        s = df[c]
        inferred = (
            "numeric" if pd.api.types.is_numeric_dtype(s)
            else "datetime" if pd.api.types.is_datetime64_any_dtype(s)
            else "categorical"
        )
        top_values = []
        try:
            vc = s.dropna().astype(str).value_counts().head(5)
            top_values = [TopValue(value=k, count=int(v)) for k, v in vc.items()]
        except Exception:
            pass
        cols.append(ColumnInsight(
            name=str(c),
            inferred_type=inferred,
            null_rate=float(s.isna().mean()),
            distinct_count=int(s.nunique(dropna=True)),
            top_values=top_values,
        ))

    return InsightsOut(summary=f"{df.shape[0]:,} rows × {df.shape[1]} columns", columns=cols)


# ---------------------------------------------------------------------------
# POST /health — full data health diagnostic
# ---------------------------------------------------------------------------

@router.post("/{file_id}/health", response_model=HealthOut)
def file_health(
    file_id: str,
    payload: HealthIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    df = _load_dataframe_from_blob(file, sheet_name=payload.sheet_name)
    n_rows = len(df)
    n_cols = len(df.columns)

    if n_rows == 0:
        raise HTTPException(status_code=422, detail="The uploaded file contains no data rows.")

    issues: list[IssueOut] = []

    # -----------------------------------------------------------------------
    # 1. COMPLETENESS
    # -----------------------------------------------------------------------
    null_counts = df.isna().sum()
    null_rates  = df.isna().mean()
    overall_null_rate = float(null_rates.mean())

    missing_cols = [
        (c, float(null_rates[c]), int(null_counts[c]))
        for c in df.columns if null_rates[c] > 0
    ]
    missing_cols.sort(key=lambda x: x[1], reverse=True)

    # Flag completely empty columns separately — these are a structural problem
    empty_cols = [c for c, r, _ in missing_cols if r == 1.0]
    if empty_cols:
        issues.append(IssueOut(
            key="empty_columns",
            severity="critical",
            title=f"{len(empty_cols)} completely empty field{'s' if len(empty_cols) > 1 else ''} found",
            plain_message=(
                f"The following field{'s have' if len(empty_cols) > 1 else ' has'} no data at all: "
                f"{', '.join(empty_cols[:5])}{'…' if len(empty_cols) > 5 else ''}. "
                f"These fields are taking up space but providing no value."
            ),
            recommendation=(
                "Check whether these fields are supposed to be captured. If they should contain data, "
                "fix the data export or entry process. If they are intentionally unused, consider removing them."
            ),
        ))

    # Constant columns (single value, not empty) — data quality signal
    constant_cols = [
        c for c in df.columns
        if df[c].nunique(dropna=True) == 1 and null_rates[c] < 1.0
    ]
    if constant_cols:
        issues.append(IssueOut(
            key="constant_columns",
            severity="info",
            title=f"{len(constant_cols)} field{'s have' if len(constant_cols) > 1 else ' has'} only one value",
            plain_message=(
                f"The field{'s' if len(constant_cols) > 1 else ''} "
                f"{', '.join(constant_cols[:4])}{'…' if len(constant_cols) > 4 else ''} "
                f"contain{'s' if len(constant_cols) == 1 else ''} the same value in every record. "
                f"This may be intentional (e.g. a status code) or a sign the data wasn't exported correctly."
            ),
            recommendation=(
                "Verify these fields are behaving as expected. If they should vary, "
                "check your data source or export filter."
            ),
        ))

    if overall_null_rate > 0.20:
        issues.append(IssueOut(
            key="completeness",
            severity="critical",
            title="Large amounts of missing information",
            plain_message=(
                f"On average, {overall_null_rate:.0%} of values across your dataset are empty. "
                f"The worst affected fields are: {', '.join(c for c, _, _ in missing_cols[:3])}."
            ),
            recommendation=(
                "Review your data entry process for the fields listed above. "
                "Missing information can cause incorrect reports and missed communications."
            ),
        ))
    elif overall_null_rate > 0.05:
        worst = missing_cols[0] if missing_cols else None
        issues.append(IssueOut(
            key="completeness",
            severity="warning",
            title="Some fields have missing information",
            plain_message=(
                f"About {overall_null_rate:.0%} of cells are empty across your dataset. "
                + (
                    f"The field '{worst[0]}' is the most incomplete, with "
                    f"{worst[1]:.0%} of its values missing ({worst[2]:,} records)."
                    if worst else ""
                )
            ),
            recommendation=(
                "Check which fields are consistently left blank and consider making them "
                "required in your data entry system."
            ),
        ))
    elif overall_null_rate > 0:
        issues.append(IssueOut(
            key="completeness",
            severity="info",
            title="A small number of empty fields",
            plain_message=f"Less than {overall_null_rate:.1%} of cells are empty — this is generally fine.",
            recommendation="No action required, but worth periodically reviewing your most important fields.",
        ))

    # Score: softer multiplier (150 instead of 200) so moderate missingness doesn't crater the score
    completeness_score = max(0.0, min(100.0, 100.0 - (overall_null_rate * 150.0)))

    # -----------------------------------------------------------------------
    # 2. UNIQUENESS
    # -----------------------------------------------------------------------
    duplicate_count = int(df.duplicated(keep=False).sum())
    dup_rate = duplicate_count / n_rows if n_rows > 0 else 0.0

    if dup_rate > 0.10:
        issues.append(IssueOut(
            key="uniqueness",
            severity="critical",
            title="Many duplicate records found",
            plain_message=(
                f"We found {duplicate_count:,} duplicate rows out of {n_rows:,} total records "
                f"({dup_rate:.0%} of your data). Duplicates can cause inflated counts, "
                f"double-billing, and misleading reports."
            ),
            recommendation=(
                "Remove or merge duplicate records. Check whether your data source is sending "
                "the same records multiple times and fix the export process."
            ),
        ))
    elif dup_rate > 0.01:
        issues.append(IssueOut(
            key="uniqueness",
            severity="warning",
            title="Duplicate records detected",
            plain_message=(
                f"We found {duplicate_count:,} duplicate rows ({dup_rate:.1%} of records). "
                f"A small number of duplicates is common but worth reviewing."
            ),
            recommendation=(
                "Confirm these are true duplicates (not separate events that look identical). "
                "Remove confirmed duplicates."
            ),
        ))

    # Softer multiplier (150) — a small duplicate rate shouldn't devastate the score
    uniqueness_score = max(0.0, min(100.0, 100.0 - (dup_rate * 150.0)))

    # -----------------------------------------------------------------------
    # 3. VALIDITY
    # -----------------------------------------------------------------------
    validity_issues_found = []

    for c in df.columns:
        s = df[c]
        if s.dtype != object:
            continue
        non_null = s.dropna()
        if len(non_null) == 0:
            continue
        sample = non_null.astype(str).head(500)

        # Numeric stored as text
        coerced = pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce")
        looks_numeric = float(sample.str.match(r"^[\d,.\-\s]+$").mean())
        fail_rate = float(coerced.isna().mean())
        if looks_numeric > 0.7 and fail_rate > 0.15:
            validity_issues_found.append(f"'{c}' looks like a number column but contains text values")
            continue

        # Date column with inconsistent formats (removed deprecated infer_datetime_format)
        date_pattern = r"^\d{1,4}[-/\.]\d{1,2}[-/\.]\d{1,4}$"
        if float(sample.str.match(date_pattern).mean()) > 0.7:
            try:
                parsed = pd.to_datetime(sample, errors="coerce")
                if parsed.isna().mean() > 0.3:
                    validity_issues_found.append(
                        f"'{c}' looks like a date column but has inconsistent date formats"
                    )
            except Exception:
                pass

        # Email column with invalid addresses
        if any(kw in c.lower() for kw in ("email", "e-mail", "mail")):
            email_pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
            invalid_rate = float((~sample.str.match(email_pattern, na=True)).mean())
            if invalid_rate > 0.05:
                validity_issues_found.append(
                    f"'{c}' contains {invalid_rate:.0%} values that don't look like valid email addresses"
                )

    parse_rate = len(validity_issues_found) / max(1, n_cols)

    if validity_issues_found:
        severity = "critical" if parse_rate > 0.3 else "warning"
        issues.append(IssueOut(
            key="validity",
            severity=severity,
            title="Some fields have formatting problems",
            plain_message=(
                f"We found {len(validity_issues_found)} field(s) where the data doesn't match "
                f"the expected format: {'; '.join(validity_issues_found[:4])}."
            ),
            recommendation=(
                "Review the listed fields. Formatting problems often mean data was entered or exported "
                "incorrectly. Fix the source data or standardize the format."
            ),
        ))

    validity_score = max(0.0, min(100.0, 100.0 - (parse_rate * 200.0)))

    # -----------------------------------------------------------------------
    # 4. DISTRIBUTION — IQR outlier detection
    # -----------------------------------------------------------------------
    outlier_details = []
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    total_outlier_count = 0

    for c in numeric_cols:
        s = df[c].dropna()
        if len(s) < 20:
            continue
        q1 = float(s.quantile(0.25))
        q3 = float(s.quantile(0.75))
        iqr = q3 - q1
        if iqr == 0:
            continue
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        mask = (s < lower) | (s > upper)
        col_count = int(mask.sum())
        total_outlier_count += col_count
        if col_count > 0:
            outlier_details.append((c, col_count, float(s[mask].abs().max())))

    outlier_rate = total_outlier_count / max(1, n_rows * max(1, len(numeric_cols)))

    if outlier_details and outlier_rate > 0.05:
        top_cols = sorted(outlier_details, key=lambda x: x[1], reverse=True)[:3]
        issues.append(IssueOut(
            key="distribution",
            severity="warning",
            title="Unusually high or low values detected",
            plain_message=(
                f"We found {total_outlier_count:,} values that are far outside the normal range "
                f"for their column. The most affected fields are: "
                f"{', '.join(f'{c} ({n:,} values)' for c, n, _ in top_cols)}. "
                f"These could be data entry errors or legitimate extreme cases."
            ),
            recommendation=(
                "Review the flagged values in the listed fields. Decide whether they are real "
                "data points or mistakes. Errors should be corrected in your source system."
            ),
        ))
    elif outlier_details:
        issues.append(IssueOut(
            key="distribution",
            severity="info",
            title="A few unusual values found",
            plain_message=(
                f"We found {total_outlier_count:,} values that fall outside the normal range. "
                f"This is often fine but worth a quick check."
            ),
            recommendation="Spot-check the highest and lowest values in your numeric fields to confirm they are correct.",
        ))

    # Softer penalty: outlier_rate × 100 (so a dataset that is 100% outliers by IQR → score 0)
    distribution_score = max(0.0, min(100.0, 100.0 - (outlier_rate * 100.0)))

    # -----------------------------------------------------------------------
    # 5. WEIGHTED OVERALL SCORE
    # -----------------------------------------------------------------------
    weights = {"completeness": 0.35, "uniqueness": 0.30, "validity": 0.20, "distribution": 0.15}
    raw_scores = {
        "completeness": completeness_score,
        "uniqueness": uniqueness_score,
        "validity": validity_score,
        "distribution": distribution_score,
    }
    overall_score = round(sum(raw_scores[k] * weights[k] for k in weights), 1)

    # -----------------------------------------------------------------------
    # 6. PER-COLUMN DETAIL RECORDS
    # -----------------------------------------------------------------------
    outlier_map = {c: n for c, n, _ in outlier_details}
    column_details: list[ColumnHealthDetail] = []

    for c in df.columns:
        s = df[c]
        is_numeric = pd.api.types.is_numeric_dtype(s)
        is_datetime = pd.api.types.is_datetime64_any_dtype(s)
        inferred_type = "numeric" if is_numeric else "datetime" if is_datetime else "text"
        n_distinct = int(s.nunique(dropna=True))

        top_values: list[TopValue] = []
        try:
            vc = s.dropna().astype(str).value_counts().head(5)
            top_values = [TopValue(value=k, count=int(v)) for k, v in vc.items()]
        except Exception:
            pass

        detail = ColumnHealthDetail(
            name=str(c),
            null_rate=round(float(null_rates[c]), 4),
            null_count=int(null_counts[c]),
            distinct_count=n_distinct,
            total_count=n_rows,
            inferred_type=inferred_type,
            cardinality_class=_cardinality_class(n_distinct, n_rows),
            outlier_count=outlier_map.get(c),
            top_values=top_values,
        )

        if is_numeric:
            non_null = s.dropna()
            detail.min_value    = _safe_float(non_null.min())
            detail.max_value    = _safe_float(non_null.max())
            detail.mean_value   = _safe_float(non_null.mean())
            detail.median_value = _safe_float(non_null.median())
            detail.std_dev      = _safe_float(non_null.std())
            detail.pct_25       = _safe_float(non_null.quantile(0.25))
            detail.pct_75       = _safe_float(non_null.quantile(0.75))
            detail.skewness     = _safe_float(non_null.skew())

        column_details.append(detail)

    return HealthOut(
        score=overall_score,
        grade=_grade(overall_score),
        score_label=_score_label(overall_score),
        category_scores={
            "completeness": round(completeness_score, 1),
            "uniqueness":   round(uniqueness_score, 1),
            "validity":     round(validity_score, 1),
            "distribution": round(distribution_score, 1),
        },
        category_labels={
            "completeness": "Complete Information",
            "uniqueness":   "No Duplicate Records",
            "validity":     "Correct Formatting",
            "distribution": "Realistic Values",
        },
        scoring_explanation={
            "completeness": f"{overall_null_rate:.1%} of cells are empty across all fields",
            "uniqueness":   f"{duplicate_count:,} duplicate rows ({dup_rate:.1%} of records)",
            "validity":     f"{len(validity_issues_found)} field(s) with formatting issues",
            "distribution": f"{total_outlier_count:,} values outside the normal range (IQR method)",
        },
        issues=issues,
        column_details=column_details,
        total_rows=n_rows,
        total_columns=n_cols,
        duplicate_count=duplicate_count,
    )


# ---------------------------------------------------------------------------
# POST /custom-charts — user-configured dashboard charts
# ---------------------------------------------------------------------------

class ChartRequest(BaseModel):
    id: str
    chart_type: str = "bar"       # bar | line | scatter | histogram | box | pie
    x: Optional[str] = None
    y: Optional[str] = None
    agg: str = "count"            # count | sum | mean | median
    color_by: Optional[str] = None
    title: Optional[str] = None


class CustomDashboardIn(BaseModel):
    charts: List[ChartRequest] = []
    filters: Optional[Dict[str, Optional[str]]] = {}
    sheet_name: Optional[str] = None


_MAX_SCATTER_PTS = 8_000
_MAX_CATS        = 30
_MAX_PIE_SLICES  = 15


def _build_chart(df: pd.DataFrame, req: ChartRequest) -> Optional[dict]:
    """Return a Plotly figure serialised as a plain dict, or None on failure."""
    x_col    = req.x      if req.x      and req.x      in df.columns else None
    y_col    = req.y      if req.y      and req.y      in df.columns else None
    color_col = req.color_by if req.color_by and req.color_by in df.columns else None
    agg       = req.agg or "count"

    try:
        fig = None

        # ── Histogram ──────────────────────────────────────────────────────────
        if req.chart_type == "histogram":
            if not x_col:
                return None
            s = df[x_col].dropna()
            if not pd.api.types.is_numeric_dtype(s):
                return None
            p99 = float(s.quantile(0.99))
            s = s[s <= p99]
            fig = px.histogram(s.rename(x_col).to_frame(), x=x_col, nbins=40)
            fig.update_layout(bargap=0.05)

        # ── Bar ────────────────────────────────────────────────────────────────
        elif req.chart_type == "bar":
            if not x_col:
                return None
            grp = [x_col] + ([color_col] if color_col else [])
            if y_col and pd.api.types.is_numeric_dtype(df[y_col]):
                agg_fns = {"mean": "mean", "median": "median", "sum": "sum"}
                if agg in agg_fns:
                    agg_df = df.groupby(grp)[y_col].agg(agg_fns[agg]).reset_index()
                else:
                    agg_df = df.groupby(grp).size().reset_index(name=y_col)
                top = df[x_col].value_counts().head(_MAX_CATS).index
                agg_df = agg_df[agg_df[x_col].isin(top)]
                fig = px.bar(agg_df, x=x_col, y=y_col, color=color_col, barmode="group")
            else:
                vc = df[x_col].value_counts().head(_MAX_CATS).reset_index()
                vc.columns = [x_col, "count"]
                fig = px.bar(vc, x=x_col, y="count", color=color_col)

        # ── Line ───────────────────────────────────────────────────────────────
        elif req.chart_type == "line":
            if not x_col or not y_col:
                return None
            if not pd.api.types.is_numeric_dtype(df[y_col]):
                return None
            grp = [x_col] + ([color_col] if color_col else [])
            line_df = df.groupby(grp)[y_col].mean().reset_index()
            line_df = line_df.sort_values(x_col)
            fig = px.line(line_df, x=x_col, y=y_col, color=color_col)

        # ── Scatter ────────────────────────────────────────────────────────────
        elif req.chart_type == "scatter":
            if not x_col or not y_col:
                return None
            if not pd.api.types.is_numeric_dtype(df[x_col]) or \
               not pd.api.types.is_numeric_dtype(df[y_col]):
                return None
            cols_needed = [x_col, y_col] + ([color_col] if color_col else [])
            plot_df = df[cols_needed].dropna()
            if len(plot_df) > _MAX_SCATTER_PTS:
                plot_df = plot_df.sample(_MAX_SCATTER_PTS, random_state=42)
            fig = px.scatter(plot_df, x=x_col, y=y_col, color=color_col,
                             opacity=0.65, trendline=None)

        # ── Box ────────────────────────────────────────────────────────────────
        elif req.chart_type == "box":
            if not y_col:
                return None
            if not pd.api.types.is_numeric_dtype(df[y_col]):
                return None
            cols_needed = [y_col] + ([x_col] if x_col else []) + \
                          ([color_col] if color_col else [])
            plot_df = df[cols_needed].dropna()
            # Limit categories if x is categorical
            if x_col:
                top = df[x_col].value_counts().head(_MAX_CATS).index
                plot_df = plot_df[plot_df[x_col].isin(top)]
            fig = px.box(plot_df, x=x_col, y=y_col, color=color_col)

        # ── Pie ────────────────────────────────────────────────────────────────
        elif req.chart_type == "pie":
            if not x_col:
                return None
            if y_col and pd.api.types.is_numeric_dtype(df[y_col]):
                pie_df = df.groupby(x_col)[y_col].sum().reset_index()
                pie_df = pie_df.nlargest(_MAX_PIE_SLICES, y_col)
                fig = px.pie(pie_df, names=x_col, values=y_col)
            else:
                vc = df[x_col].value_counts().head(_MAX_PIE_SLICES).reset_index()
                vc.columns = [x_col, "count"]
                fig = px.pie(vc, names=x_col, values="count")

        if fig is None:
            return None

        fig.update_layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            margin=dict(l=40, r=20, t=30, b=50),
            showlegend=bool(color_col),
        )

        return _json.loads(fig.to_json())

    except Exception:
        return None


@router.post("/{file_id}/custom-charts")
def build_custom_charts(
    file_id: str,
    payload: CustomDashboardIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    df = _load_dataframe_from_blob(file, sheet_name=payload.sheet_name)

    # Apply simple equality filters
    for col, val in (payload.filters or {}).items():
        if val and col in df.columns:
            df = df[df[col].astype(str) == str(val)]

    charts_out: dict = {}
    for req in payload.charts:
        result = _build_chart(df, req)
        if result is not None:
            charts_out[req.id] = result

    return {"charts": charts_out}


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------

class DedupeIn(BaseModel):
    mode: str = "full_row"          # "full_row" | "columns"
    columns: List[str] = []         # only used when mode == "columns"
    keep: str = "first"             # "first" | "last"
    sheet_name: Optional[str] = None


class DedupePreviewOut(BaseModel):
    original_rows: int
    duplicate_count: int
    cleaned_rows: int
    pct_removed: float


def _run_dedupe(df: pd.DataFrame, payload: DedupeIn) -> pd.DataFrame:
    keep = payload.keep if payload.keep in ("first", "last") else "first"
    if payload.mode == "columns" and payload.columns:
        valid_cols = [c for c in payload.columns if c in df.columns]
        if not valid_cols:
            raise HTTPException(status_code=422, detail="None of the specified columns exist in this file.")
        return df.drop_duplicates(subset=valid_cols, keep=keep)
    return df.drop_duplicates(keep=keep)


@router.post("/{file_id}/dedupe/preview", response_model=DedupePreviewOut)
def dedupe_preview(
    file_id: str,
    payload: DedupeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    df = _load_dataframe_from_blob(file, sheet_name=payload.sheet_name)
    cleaned = _run_dedupe(df, payload)

    original_rows = len(df)
    cleaned_rows = len(cleaned)
    duplicate_count = original_rows - cleaned_rows
    pct_removed = round((duplicate_count / original_rows * 100) if original_rows > 0 else 0.0, 2)

    return DedupePreviewOut(
        original_rows=original_rows,
        duplicate_count=duplicate_count,
        cleaned_rows=cleaned_rows,
        pct_removed=pct_removed,
    )


@router.post("/{file_id}/dedupe/download")
def dedupe_download(
    file_id: str,
    payload: DedupeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(FileModel.id == file_id, FileModel.tenant_id == user.tenant_id)
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    df = _load_dataframe_from_blob(file, sheet_name=payload.sheet_name)
    cleaned = _run_dedupe(df, payload)

    base = file.original_name.rsplit(".", 1)[0] if "." in file.original_name else file.original_name
    download_name = f"{base}_deduped.csv"

    buf = io.StringIO()
    cleaned.to_csv(buf, index=False)
    buf.seek(0)

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": _content_disposition_attachment(download_name)},
    )
