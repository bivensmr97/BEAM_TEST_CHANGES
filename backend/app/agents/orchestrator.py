"""
Lightweight orchestrator — classifies the user's intent and returns the list of
specialist agents to invoke.  This is a fast, temperature-0, JSON-only call so
it adds as little latency as possible before streaming begins.
"""

import json

VALID_AGENTS = {
    "health_advisor",
    "data_quality_coach",
    "chart_interpreter",
    "action_planner",
    "app_guide",
}

_SYSTEM = """You are a routing assistant for BEAM Analytics, a data quality platform.
Your ONLY job is to classify the user's message and return a JSON response.

Available specialists:
- health_advisor      : score, grade, quality dimensions, what issues mean
- data_quality_coach  : how to fix problems — duplicates, missing values, data errors
- chart_interpreter   : understanding charts, what a visualisation shows, which chart to use
- action_planner      : what to do next, prioritised action plan, where to start
- app_guide           : how to use the app, where to find features, navigation questions

Respond with ONLY valid JSON: {"agents": ["specialist_name"]}
Use one specialist unless the question genuinely spans two domains.
Default to health_advisor when uncertain."""


def route_message(client, model: str, message: str, tab: str) -> list[str]:
    """Return a list of specialist agent names for the given message."""
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Current tab: {tab}\nUser message: {message}"},
            ],
            response_format={"type": "json_object"},
            max_tokens=30,
            temperature=0,
        )
        result = json.loads(response.choices[0].message.content or "{}")
        agents = [a for a in (result.get("agents") or []) if a in VALID_AGENTS]
        return agents or _fallback(tab)
    except Exception:
        return _fallback(tab)


def _fallback(tab: str) -> list[str]:
    return {
        "health": ["health_advisor"],
        "explore": ["chart_interpreter"],
        "overview": ["health_advisor"],
    }.get(tab, ["health_advisor"])
