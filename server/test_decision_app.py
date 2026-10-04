from fastapi.testclient import TestClient

import decision_app
from decision_provider import Decision, ProviderUnavailable


class StubProvider:
    readiness = "ready"

    def decide(self, text: str) -> Decision:
        assert text == "Compare plans"
        return Decision(
            intent="compare",
            scores={"calendar": 0.01, "checklist": 0.02, "compare": 0.90, "draft_message": 0.03, "none": 0.04},
            provider="laya",
            model="test-model",
            decision_ms=12.5,
            abstained=False,
        )


def test_decision_contract(monkeypatch):
    monkeypatch.setattr(decision_app, "provider", StubProvider())
    response = TestClient(decision_app.app).post("/api/decision", json={"text": "Compare plans", "request_id": 7})
    assert response.status_code == 200
    assert response.json() == {
        "request_id": 7, "intent": "compare", "scores": {"calendar": 0.01, "checklist": 0.02, "compare": 0.9, "draft_message": 0.03, "none": 0.04},
        "provider": "laya", "model": "test-model", "decision_ms": 12.5, "abstained": False, "experimental": False,
    }


def test_rejects_oversized_or_empty_drafts():
    client = TestClient(decision_app.app)
    assert client.post("/api/decision", json={"text": "", "request_id": 1}).status_code == 422
    assert client.post("/api/decision", json={"text": "x" * 601, "request_id": 1}).status_code == 422


def test_model_failure_is_honest_unavailable(monkeypatch):
    class FailingProvider:
        readiness = "unavailable"

        def decide(self, text: str):
            raise ProviderUnavailable("unavailable")

    monkeypatch.setattr(decision_app, "provider", FailingProvider())
    response = TestClient(decision_app.app).post("/api/decision", json={"text": "Compare plans", "request_id": 9})
    assert response.status_code == 503
    assert response.json()["detail"] == "Local decision provider unavailable."
