from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional

SectionType = Literal["cards", "table", "chart", "text"]

class SummaryCard(BaseModel):
    label: str
    value: Any
    sublabel: Optional[str] = None

class Issue(BaseModel):
    id: str
    severity: Literal["low", "medium", "high"]
    title: str
    message: str
    recommendation: Optional[str] = None

class Section(BaseModel):
    type: SectionType
    title: str
    payload: Dict[str, Any]

class ToolEnvelope(BaseModel):
    tool: str
    dataset_id: str
    run_id: str
    summary_cards: List[SummaryCard] = []
    issues: List[Issue] = []
    sections: List[Section] = []
    exports: Dict[str, Any] = {}
