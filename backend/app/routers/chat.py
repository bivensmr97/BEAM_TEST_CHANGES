"""
Streaming multi-agent chat endpoint.

Flow per request:
  1. Orchestrator (fast, JSON-mode, no streaming) → selects specialist agents
  2. Emit routing event so the frontend can display the agent label immediately
  3. Specialist agent streams tokens directly to the client
  4. Log LLM usage at end of stream

The orchestrator is intentionally lightweight — it adds ~300ms before the first
token arrives, which is acceptable given that users see the agent label appear
before the response begins.
"""

import json
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Any, Optional

from app.auth import get_current_user
from app.config import get_settings
from app.deps import get_db
from app.insights import _log_llm_usage
from app.models import File as FileModel, Tenant, User
from app.agents.orchestrator import route_message
from app.agents.specialists import build_specialist_messages, build_explain_messages, build_action_plan_messages

router = APIRouter()


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class ChatHistoryItem(BaseModel):
    role: str       # "user" | "assistant"
    content: str


class HealthSummary(BaseModel):
    score: float
    grade: str
    score_label: str
    total_rows: int
    total_columns: int
    duplicate_count: int
    issues: list[dict[str, Any]] = []
    category_scores: dict[str, float] = {}
    category_labels: dict[str, str] = {}
    scoring_explanation: dict[str, str] = {}


class ChatContext(BaseModel):
    tab: str = "overview"
    sheet_name: Optional[str] = None
    health_summary: Optional[HealthSummary] = None
    column_types: list[dict[str, Any]] = []


class ChatRequest(BaseModel):
    message: str
    context: ChatContext
    history: list[ChatHistoryItem] = []


class ExplainIssueRequest(BaseModel):
    issue: dict[str, Any]
    total_rows: int = 0
    total_columns: int = 0


class ActionPlanRequest(BaseModel):
    health: dict[str, Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _check_ai_enabled(db: Session, user: User) -> bool:
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    return bool(tenant and tenant.ai_enabled and user.ai_enabled)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/{file_id}/chat")
def chat_with_file(
    file_id: str,
    payload: ChatRequest,
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

    settings = get_settings()
    model = settings.OPENAI_MODEL

    # --- AI disabled ---
    if not _check_ai_enabled(db, user):
        def _disabled():
            yield _sse({"type": "token", "content": "AI is currently disabled for your account. You can re-enable it in Settings (gear icon, top right)."})
            yield _sse({"type": "done"})
        return StreamingResponse(_disabled(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        def _no_key():
            yield _sse({"type": "token", "content": "AI is not configured on this server. Please contact your administrator."})
            yield _sse({"type": "done"})
        return StreamingResponse(_no_key(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    context_dict = payload.context.model_dump()
    history_list = [h.model_dump() for h in payload.history]
    tab = payload.context.tab

    def generate():
        prompt_tokens = 0
        completion_tokens = 0
        agents = ["health_advisor"]

        try:
            # ── Step 1: Route ────────────────────────────────────────────────
            agents = route_message(
                client=client,
                model=model,
                message=payload.message,
                tab=tab,
            )
            yield _sse({"type": "routing", "agents": agents})

            # ── Step 2: Build specialist messages ────────────────────────────
            messages = build_specialist_messages(
                agents=agents,
                message=payload.message,
                context=context_dict,
                history=history_list,
                file_name=file.original_name,
            )

            # ── Step 3: Stream specialist response ───────────────────────────
            with client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                max_tokens=600,
            ) as stream:
                for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield _sse({"type": "token", "content": chunk.choices[0].delta.content})
                    if getattr(chunk, "usage", None):
                        prompt_tokens = chunk.usage.prompt_tokens or 0
                        completion_tokens = chunk.usage.completion_tokens or 0

            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation=f"chat_{'_'.join(sorted(agents))}",
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                status="success",
            )

        except Exception as ex:
            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation="chat_error",
                model=model,
                status="error",
                error_message=str(ex)[:500],
            )
            yield _sse({"type": "error", "content": "Something went wrong. Please try again."})

        finally:
            yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Explain issue endpoint (no orchestrator — intent is known)
# ---------------------------------------------------------------------------

@router.post("/{file_id}/explain-issue")
def explain_issue(
    file_id: str,
    payload: ExplainIssueRequest,
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

    settings = get_settings()
    model = settings.OPENAI_MODEL

    if not _check_ai_enabled(db, user):
        def _disabled():
            yield _sse({"type": "token", "content": "AI is currently disabled for your account."})
            yield _sse({"type": "done"})
        return StreamingResponse(_disabled(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        def _no_key():
            yield _sse({"type": "token", "content": "AI is not configured on this server."})
            yield _sse({"type": "done"})
        return StreamingResponse(_no_key(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    messages = build_explain_messages(
        issue=payload.issue,
        file_name=file.original_name,
        file_rows=payload.total_rows,
        file_columns=payload.total_columns,
    )

    def generate():
        prompt_tokens = 0
        completion_tokens = 0
        try:
            with client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                max_tokens=300,
            ) as stream:
                for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield _sse({"type": "token", "content": chunk.choices[0].delta.content})
                    if getattr(chunk, "usage", None):
                        prompt_tokens = chunk.usage.prompt_tokens or 0
                        completion_tokens = chunk.usage.completion_tokens or 0

            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation="explain_issue",
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                status="success",
            )
        except Exception as ex:
            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation="explain_issue",
                model=model,
                status="error",
                error_message=str(ex)[:500],
            )
            yield _sse({"type": "error", "content": "Could not generate explanation. Please try again."})
        finally:
            yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Action plan endpoint (no orchestrator — intent is known)
# ---------------------------------------------------------------------------

@router.post("/{file_id}/action-plan")
def action_plan(
    file_id: str,
    payload: ActionPlanRequest,
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

    settings = get_settings()
    model = settings.OPENAI_MODEL

    if not _check_ai_enabled(db, user):
        def _disabled():
            yield _sse({"type": "token", "content": "AI is currently disabled for your account."})
            yield _sse({"type": "done"})
        return StreamingResponse(_disabled(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        def _no_key():
            yield _sse({"type": "token", "content": "AI is not configured on this server."})
            yield _sse({"type": "done"})
        return StreamingResponse(_no_key(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    messages = build_action_plan_messages(
        health=payload.health,
        file_name=file.original_name,
    )

    def generate():
        prompt_tokens = 0
        completion_tokens = 0
        try:
            with client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                max_tokens=400,
            ) as stream:
                for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield _sse({"type": "token", "content": chunk.choices[0].delta.content})
                    if getattr(chunk, "usage", None):
                        prompt_tokens = chunk.usage.prompt_tokens or 0
                        completion_tokens = chunk.usage.completion_tokens or 0

            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation="action_plan",
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                status="success",
            )
        except Exception as ex:
            _log_llm_usage(
                db=db,
                tenant_id=user.tenant_id,
                user_id=user.id,
                file_id=file.id,
                operation="action_plan",
                model=model,
                status="error",
                error_message=str(ex)[:500],
            )
            yield _sse({"type": "error", "content": "Could not generate action plan. Please try again."})
        finally:
            yield _sse({"type": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
