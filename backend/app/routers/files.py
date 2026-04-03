# backend/app/routers/files.py
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
from uuid import uuid4, UUID
from datetime import datetime
import re
from urllib.parse import quote

from azure.storage.blob import BlobServiceClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_db
from app.auth import get_current_user
from app.models import File as FileModel, User 

import io
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional

router = APIRouter()

settings = get_settings()
blob_service = BlobServiceClient.from_connection_string(settings.AZURE_BLOB_CONNSTRING)
container_client = blob_service.get_container_client(settings.BLOB_CONTAINER)


class FileOut(BaseModel):
    id: UUID
    original_name: str
    uploaded_at: datetime
    status: str
    size_bytes: int | None

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
    severity: str  # "low" | "med" | "high"
    message: str

class HealthOut(BaseModel):
    score: float
    grade: str
    category_scores: Dict[str, float]
    issues: list[IssueOut]

class HealthIn(BaseModel):
    yaml_config: Optional[str] = None 


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
        raise HTTPException(status_code=400, detail="Unsupported file type")

    file_id = str(uuid4())
    tenant_prefix = f"tenant_{user.tenant_id}/file_{file_id}"
    blob_path = f"{tenant_prefix}/raw/{uploaded_file.filename}"

    data = await uploaded_file.read()

    try:
        blob_client = container_client.get_blob_client(blob_path)
        blob_client.upload_blob(data, overwrite=True)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Blob upload failed: {ex}")

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
def list_files(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    files = (
        db.query(FileModel)
        .filter(FileModel.tenant_id == user.tenant_id)
        .order_by(FileModel.uploaded_at.desc())
        .all()
    )
    return files


@router.get("/{file_id}", response_model=FileOut)
def get_file(
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(
            FileModel.id == file_id,
            FileModel.tenant_id == user.tenant_id,
        )
        .first()
    )
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return file


def _content_disposition_attachment(filename: str) -> str:
    """Build a safe Content-Disposition header value with RFC 5987 support.

    We include both:
      - filename="..." (ASCII-ish fallback)
      - filename*=UTF-8''... (RFC 5987, full UTF-8)

    This is widely supported by modern browsers and should not break older ones.
    """
    name = filename or "download"
    # Strip CR/LF and quotes to avoid header injection / broken headers.
    name = re.sub(r"[\r\n]", " ", name).replace('"', "")

    # ASCII fallback: keep common safe chars, replace others with underscore.
    fallback = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip() or "download"

    # RFC 5987 encoding for UTF-8 filenames
    encoded = quote(name, safe="")

    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"

def _load_dataframe_from_blob(file: FileModel) -> pd.DataFrame:
    blob_client = container_client.get_blob_client(file.blob_path)
    data = blob_client.download_blob().readall()

    name_lc = (file.original_name or "").lower()
    if name_lc.endswith(".csv"):
        return pd.read_csv(io.BytesIO(data))
    if name_lc.endswith(".xlsx") or name_lc.endswith(".xls"):
        return pd.read_excel(io.BytesIO(data))
    raise HTTPException(status_code=400, detail="Unsupported file type for parsing")


@router.get("/{file_id}/download")
@router.get("/{file_id}/download/")
def download_file(
    file_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    file = (
        db.query(FileModel)
        .filter(
            FileModel.id == file_id,
            FileModel.tenant_id == user.tenant_id,
        )
        .first()
    )
    if not file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    try:
        blob_client = container_client.get_blob_client(file.blob_path)
        downloader = blob_client.download_blob()

        def stream():
            for chunk in downloader.chunks():
                yield chunk

        name_lc = (file.original_name or "").lower()
        if name_lc.endswith(".csv"):
            media_type = "text/csv"
        elif name_lc.endswith(".xlsx"):
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif name_lc.endswith(".xls"):
            media_type = "application/vnd.ms-excel"
        else:
            media_type = "application/octet-stream"

        headers = {
            "Content-Disposition": _content_disposition_attachment(file.original_name),
        }

        return StreamingResponse(stream(), media_type=media_type, headers=headers)

    except Exception as ex:
        raise HTTPException(status_code=500, detail=f"Download failed: {ex}")
    
@router.get("/{file_id}/insights", response_model=InsightsOut)
def file_insights(
    file_id: str,
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

    df = _load_dataframe_from_blob(file)

    cols = []
    for c in df.columns:
        s = df[c]
        null_rate = float(s.isna().mean())
        distinct_count = int(s.nunique(dropna=True))

        inferred = "unknown"
        if pd.api.types.is_numeric_dtype(s):
            inferred = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(s):
            inferred = "datetime"
        else:
            inferred = "categorical"

        top_values = []
        try:
            vc = s.dropna().astype(str).value_counts().head(5)
            top_values = [TopValue(value=k, count=int(v)) for k, v in vc.items()]
        except Exception:
            top_values = []

        cols.append(
            ColumnInsight(
                name=str(c),
                inferred_type=inferred,
                null_rate=null_rate,
                distinct_count=distinct_count,
                top_values=top_values,
            )
        )

    summary = f"{df.shape[0]} rows × {df.shape[1]} columns"

    return InsightsOut(summary=summary, columns=cols)

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

    df = _load_dataframe_from_blob(file)

    issues: list[IssueOut] = []

    # --- Basic checks (MVP) ---
    missingness = float(df.isna().mean().mean()) if df.shape[1] else 0.0
    dup_rate = float(df.duplicated().mean()) if df.shape[0] else 0.0

    # crude type parsing issues: count object cols that look numeric but aren't
    parse_issues = 0.0
    for c in df.columns:
        s = df[c]
        if s.dtype == "object":
            sample = s.dropna().astype(str).head(200)
            if len(sample) == 0:
                continue
            # if many values contain digits and commas, attempt numeric coercion
            coerced = pd.to_numeric(sample.str.replace(",", "", regex=False), errors="coerce")
            # if a lot of coercion failed but values "look numeric", flag it
            looks_numeric = sample.str.match(r"^[\d,.\-]+$").mean()
            fail_rate = float(coerced.isna().mean())
            if looks_numeric > 0.6 and fail_rate > 0.2:
                parse_issues += 1

    parse_rate = float(parse_issues / max(1, len(df.columns)))

    # outliers: for numeric columns, check % beyond 3 std (simple)
    outlier_rates = []
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    for c in numeric_cols:
        s = df[c].dropna()
        if len(s) < 20:
            continue
        mu = float(s.mean())
        sd = float(s.std()) or 0.0
        if sd == 0.0:
            continue
        outlier_rates.append(float(((np.abs(s - mu) > 3 * sd)).mean()))
    outlier_rate = float(np.mean(outlier_rates)) if outlier_rates else 0.0

    # --- Category scores (0-100) ---
    def score_from_rate(rate: float) -> float:
        # 0 rate => 100 score; 50% rate => 0 score (clamp)
        return float(max(0.0, min(100.0, 100.0 * (1.0 - (rate * 2.0)))))

    category_scores = {
        "missingness": score_from_rate(missingness),
        "duplicates": score_from_rate(dup_rate),
        "parsing": score_from_rate(parse_rate),
        "outliers": score_from_rate(outlier_rate),
    }

    score = float(np.mean(list(category_scores.values())))

    if score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 60:
        grade = "D"
    else:
        grade = "F"

    # --- Issues list ---
    if missingness > 0.05:
        issues.append(IssueOut(key="missingness", severity="med", message=f"Overall missingness is {missingness:.1%}."))
    if dup_rate > 0.01:
        issues.append(IssueOut(key="duplicates", severity="med", message=f"Duplicate row rate is {dup_rate:.1%}."))
    if parse_issues > 0:
        issues.append(IssueOut(key="parsing", severity="low", message="Some columns appear numeric but contain non-numeric values."))
    if outlier_rate > 0.02:
        issues.append(IssueOut(key="outliers", severity="low", message=f"Numeric outlier rate (3σ rule) is {outlier_rate:.1%}."))

    return HealthOut(score=score, grade=grade, category_scores=category_scores, issues=issues)
