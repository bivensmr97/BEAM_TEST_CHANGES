from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid

from app.schemas.tool_envelope import ToolEnvelope
from app.services.file_insights import run_file_insights
from app.services.data_health import run_data_health

router = APIRouter(prefix="/tools", tags=["tools"])

class ToolRunRequest(BaseModel):
    dataset_id: str
    config: Optional[Dict[str, Any]] = None   

@router.post("/run/{tool_name}", response_model=ToolEnvelope)
def run_tool(tool_name: str, req: ToolRunRequest):
    run_id = str(uuid.uuid4())

    if tool_name == "file_insights":
        return run_file_insights(dataset_id=req.dataset_id, run_id=run_id, config=req.config)

    if tool_name == "data_health":
        return run_data_health(dataset_id=req.dataset_id, run_id=run_id, config=req.config)

    raise HTTPException(status_code=404, detail=f"Unknown tool: {tool_name}")
