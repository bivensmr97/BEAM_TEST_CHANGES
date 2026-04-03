from app.schemas.tool_envelope import ToolEnvelope, SummaryCard, Section
import pandas as pd
import os

# TODO: replace this with your real "load dataset by id" logic
def load_df_for_dataset(dataset_id: str) -> pd.DataFrame:
    # Example only — you likely already store uploads somewhere
    path = os.path.join("uploads", f"{dataset_id}.csv")
    return pd.read_csv(path)

def run_file_insights(dataset_id: str, run_id: str, config=None) -> ToolEnvelope:
    df = load_df_for_dataset(dataset_id)

    cards = [
        SummaryCard(label="Total Rows", value=int(df.shape[0])),
        SummaryCard(label="Total Columns", value=int(df.shape[1])),
    ]

    # simple column overview table
    col_rows = []
    for c in df.columns:
        s = df[c]
        col_rows.append({
            "column": c,
            "dtype": str(s.dtype),
            "null_rate": float(s.isna().mean()),
            "distinct": int(s.nunique(dropna=True)),
        })

    sections = [
        Section(
            type="table",
            title="Columns Overview",
            payload={
                "columns": ["column", "dtype", "null_rate", "distinct"],
                "rows": col_rows
            },
        )
    ]

    return ToolEnvelope(
        tool="file_insights",
        dataset_id=dataset_id,
        run_id=run_id,
        summary_cards=cards,
        sections=sections,
    )
