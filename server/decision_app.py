"""Separate FastAPI service for local, non-executing UI tool suggestions."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from decision_provider import INTENTS, InputTooLong, LayaDecisionProvider, ProviderUnavailable


MAX_TEXT_CHARS = 600
MAX_CONCURRENT_DECISIONS = 1
logger = logging.getLogger("decision_app")
provider = LayaDecisionProvider(checkpoint_path=os.environ.get("LOCAL_LAYA_CHECKPOINT"))
decision_slots = asyncio.Semaphore(MAX_CONCURRENT_DECISIONS)

app = FastAPI(title="Predictive workspace decision service")


class DecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # The tokenizer check in the provider enforces the model's actual state budget.
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    request_id: int = Field(ge=0)


class DecisionResponse(BaseModel):
    request_id: int
    intent: Literal["calendar", "checklist", "compare", "draft_message", "none"]
    scores: dict[str, float]
    provider: str
    model: str
    decision_ms: float
    abstained: bool
    experimental: bool = False


@app.get("/health")
async def health() -> dict[str, str]:
    """Report readiness without loading a model or accepting a user draft."""
    return {"status": provider.readiness, "provider": "laya"}


@app.post("/api/decision", response_model=DecisionResponse)
async def decision(request: DecisionRequest) -> DecisionResponse:
    """Return an optional suggestion. This endpoint never invokes a user tool."""
    try:
        await asyncio.wait_for(decision_slots.acquire(), timeout=0.05)
    except TimeoutError as error:
        raise HTTPException(status_code=429, detail="Local decision provider is busy. Retry the latest draft.") from error
    work = asyncio.create_task(asyncio.to_thread(provider.decide, request.text))
    try:
        try:
            result = await asyncio.shield(work)
        except asyncio.CancelledError:
            # Keep the single-worker admission slot until the uninterruptible thread finishes.
            await asyncio.shield(work)
            raise
        except InputTooLong as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ProviderUnavailable as error:
            logger.warning("decision provider unavailable for request_id=%s", request.request_id)
            raise HTTPException(status_code=503, detail="Local decision provider unavailable.") from error
    finally:
        decision_slots.release()
    if set(result.scores) != set(INTENTS):
        raise HTTPException(status_code=503, detail="Local decision provider returned an invalid score set.")
    return DecisionResponse(request_id=request.request_id, **result.__dict__)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("decision_app:app", host="127.0.0.1", port=8014)
