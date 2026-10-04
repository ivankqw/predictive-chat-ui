"""Local Laya decision provider for non-executing UI suggestions."""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Final

from pilot_policy import QUESTIONS as PILOT_QUESTIONS


INTENTS: Final = ("calendar", "checklist", "compare", "draft_message", "none")
MODEL_REPOSITORY: Final = "convaiinnovations/laya"
MODEL_REVISION: Final = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"
MODEL_SHA256: Final = "891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c"
MODEL_NAME: Final = f"{MODEL_REPOSITORY}@{MODEL_REVISION}:english"
PILOT_DIGESTS: Final = {
    "model.safetensors": "239d257d21e23f74bc3928e6558ace98e35fa3b26866f802f33c111cd69f8b12",
    "rl_agent_config.json": "d8640121db50edbd83aea1c6177143a35aa5b64ab56327b81d87b275b564cb50",
    "encoder/config.json": "aac9925108ab931a457eafb081604db34de9edffa44936b5d84f74d979c4ba56",
    "tokenizer/tokenizer.json": "6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30",
    "tokenizer/tokenizer_config.json": "2966a59b9e9cf122279aec1249e22e5bc7ad8430c754e95031b13fd128d4e560",
    "tokenizer/special_tokens_map.json": "ea97ecdbcc73713039d8d64dbb05e3689495c96657fbd9a18f5bed381be81049",
}

# These are uncalibrated output scores. The gate reduces low-separation suggestions.
MIN_TOP_SCORE: Final = 0.45
MIN_MARGIN: Final = 0.15

QUESTIONS: Final = {
    "tool_suggestion": {
        "type": "choice",
        "instructions": (
            "Which non-executing workspace tool suggestion best matches the user's current "
            "message? Choose none unless the message currently asks for that work. Never "
            "infer a request from a topic alone."
        ),
        "criteria": {
            "calendar": "The user currently asks to create, change, move, cancel, or schedule a calendar event or meeting.",
            "checklist": "The user currently asks to make, add, organize, or track a task, reminder, or checklist.",
            "compare": "The user currently asks to compare options, alternatives, products, plans, or facts in a table or structured comparison.",
            "draft_message": "The user currently asks to write, compose, reply to, or edit a message, email, note, or text.",
            "none": "The message is general conversation, a partial thought, an ambiguous draft, a rejection or negation of an action, or lacks a current request for one of the listed suggestions.",
        },
    }
}


class ProviderUnavailable(RuntimeError):
    """The local model could not load or make a decision."""


class InputTooLong(ValueError):
    """The draft would be truncated by the checkpoint's state token budget."""


@dataclass(frozen=True)
class Decision:
    intent: str
    scores: dict[str, float]
    provider: str
    model: str
    decision_ms: float
    abstained: bool
    experimental: bool = False


class LayaDecisionProvider:
    """Loads the pinned checkpoint once and makes one typed choice per request."""

    def __init__(self, checkpoint_path: str | None = None) -> None:
        self._checkpoint = Path(checkpoint_path).expanduser().resolve() if checkpoint_path else None
        self._router = None
        self._load_lock = Lock()
        self._failure: str | None = None
        self._has_predicted = False

    @property
    def readiness(self) -> str:
        if self._has_predicted:
            return "ready"
        if self._failure is not None:
            return "unavailable"
        return "not_loaded"

    def _load(self) -> None:
        if self._router is not None:
            return
        with self._load_lock:
            if self._router is not None:
                return
            try:
                import torch
                from laya import Router

                device = "mps" if torch.backends.mps.is_available() else "cpu"
                if self._checkpoint is not None:
                    if not self._checkpoint.is_dir():
                        raise FileNotFoundError("The local pilot checkpoint directory does not exist.")
                    self._router = Router(
                        device=device,
                        models={"english": str(self._checkpoint)},
                        sha256_digests={"english": PILOT_DIGESTS},
                    )
                else:
                    self._router = Router(
                        device=device,
                        revision=MODEL_REVISION,
                        sha256_digests={"english": {"model.safetensors": MODEL_SHA256}},
                    )
            except Exception as error:  # Boundary converts dependency/model errors to service state.
                self._failure = type(error).__name__
                raise ProviderUnavailable("The local Laya decision model is unavailable.") from error

    def decide(self, text: str) -> Decision:
        self._load()
        assert self._router is not None
        try:
            from laya.common import encode_text

            agent = self._router.load("english")
            state_tokens = len(encode_text(agent.tok, text, add_special_tokens=False)["input_ids"])
            state_budget = int(agent.cfg.get("max_len", 512)) - int(agent.cfg.get("head_max_len", 192)) - 8
        except Exception as error:
            self._failure = type(error).__name__
            raise ProviderUnavailable("The local Laya decision model could not validate the input.") from error
        if state_tokens > state_budget:
            raise InputTooLong(f"Draft has {state_tokens} state tokens; limit is {state_budget}.")
        started = perf_counter()
        try:
            questions = PILOT_QUESTIONS if self._checkpoint else QUESTIONS
            result = self._router.predict(text, questions, model="english")
            answer = result["answers"]["tool_suggestion"]
            probabilities = answer["probabilities"]
            selected = str(answer["choice"])
        except Exception as error:
            raise ProviderUnavailable("The local Laya decision model could not make a decision.") from error
        if set(probabilities) != set(INTENTS) or selected not in INTENTS:
            raise ProviderUnavailable("The local Laya decision model returned an invalid decision shape.")
        scores = {intent: float(probabilities[intent]) for intent in INTENTS}
        if not all(math.isfinite(score) and 0.0 <= score <= 1.0 for score in scores.values()):
            raise ProviderUnavailable("The local Laya decision model returned invalid scores.")
        if not math.isclose(sum(scores.values()), 1.0, abs_tol=0.002):
            raise ProviderUnavailable("The local Laya decision model returned scores that do not sum to one.")
        if selected != max(INTENTS, key=scores.__getitem__):
            raise ProviderUnavailable("The local Laya decision model returned a non-maximum choice.")
        self._has_predicted = True
        elapsed_ms = round((perf_counter() - started) * 1000, 3)
        ranked = sorted(scores.values(), reverse=True)
        top = scores.get(selected, 0.0)
        margin = top - (ranked[1] if len(ranked) > 1 else 0.0)
        abstained = selected == "none" or top < MIN_TOP_SCORE or margin < MIN_MARGIN
        return Decision(
            intent="none" if abstained else selected,
            scores=scores,
            provider="laya",
            model="predictive-workspace-laya-20261001:calibrated" if self._checkpoint else MODEL_NAME,
            decision_ms=elapsed_ms,
            abstained=abstained,
            experimental=self._checkpoint is not None,
        )
