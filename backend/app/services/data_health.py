from app.schemas.tool_envelope import ToolEnvelope, SummaryCard, Section, Issue
import pandas as pd
import numpy as np
import os

def load_df_for_dataset(dataset_id: str) -> pd.DataFrame:
    path = os.path.join("uploads", f"{dataset_id}.csv")
    return pd.read_csv(path)

def run_data_health(dataset_id: str, run_id: str, config=None) -> ToolEnvelope:
    df = load_df_for_dataset(dataset_id)

    null_rate = float(df.isna().mean().mean())
    dup_rate = float(df.duplicated().mean())

    # Basic outlier heuristic: numeric z-score > 4
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    outlier_cols = []
    if numeric_cols:
        z = (df[numeric_cols] - df[numeric_cols].mean()) / df[numeric_cols].std(ddof=0).replace(0, np.nan)
        outlier_cols = [c for c in numeric_cols if np.nanmax(np.abs(z[c].to_numpy())) > 4]

    # Simple score (0-100). You can evolve this later.
    score = 100
    score -= int(min(40, null_rate * 100))        # up to -40
    score -= int(min(30, dup_rate * 100))         # up to -30
    score -= int(min(20, len(outlier_cols) * 3))  # small penalty per outlier-heavy col
    score = max(0, score)

    grade = "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 70 else "D" if score >= 60 else "F"

    issues = []
    if null_rate > 0.05:
        issues.append(Issue(
            id="missingness",
            severity="high" if null_rate > 0.2 else "medium",
            title="Missing values detected",
            message=f"Average null rate across dataset is {null_rate:.1%}.",
            recommendation="Consider imputing, filtering, or fixing upstream ingestion for the worst columns."
        ))
    if dup_rate > 0.01:
        issues.append(Issue(
            id="duplicates",
            severity="medium" if dup_rate < 0.1 else "high",
            title="Duplicate rows detected",
            message=f"Duplicate row rate is {dup_rate:.1%}.",
            recommendation="Define a primary key and deduplicate (keep latest/first) based on business rules."
        ))
    if outlier_cols:
        issues.append(Issue(
            id="outliers",
            severity="low",
            title="Potential outliers found",
            message=f"Outlier-like behavior detected in: {', '.join(outlier_cols[:8])}{'...' if len(outlier_cols) > 8 else ''}.",
            recommendation="Review distributions and cap/winsorize if appropriate, or validate data ranges."
        ))

    sections = [
        Section(
            type="cards",
            title="Data Health Summary",
            payload={
                "score": score,
                "grade": grade,
                "category_scores": {
                    "completeness": int(max(0, 100 - min(100, null_rate * 200))),
                    "uniqueness": int(max(0, 100 - min(100, dup_rate * 200))),
                    "validity": 90,  # placeholder until you add type/range rules
                    "consistency": 85 # placeholder
                }
            },
        )
    ]

    return ToolEnvelope(
        tool="data_health",
        dataset_id=dataset_id,
        run_id=run_id,
        summary_cards=[
            SummaryCard(label="Health Score", value=score, sublabel=f"Grade {grade}"),
            SummaryCard(label="Null Rate", value=f"{null_rate:.1%}"),
            SummaryCard(label="Duplicate Rate", value=f"{dup_rate:.1%}"),
        ],
        issues=issues,
        sections=sections,
    )
