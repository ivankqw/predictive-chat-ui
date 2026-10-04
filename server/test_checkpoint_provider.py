from types import SimpleNamespace
import sys

import pytest

from decision_provider import LayaDecisionProvider, MODEL_REVISION, PILOT_DIGESTS, ProviderUnavailable, QUESTIONS


def fake_runtime(monkeypatch):
    calls = {}
    class Router:
        def __init__(self, **kwargs):
            calls['config'] = kwargs
        def load(self, model):
            return SimpleNamespace(tok=None, cfg={})
        def predict(self, text, questions, model):
            calls['questions'] = questions
            return {'answers': {'tool_suggestion': {'choice': 'calendar', 'probabilities': {
                'calendar': .8, 'checklist': .05, 'compare': .05, 'draft_message': .05, 'none': .05,
            }}}}
    monkeypatch.setitem(sys.modules, 'torch', SimpleNamespace(backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False))))
    monkeypatch.setitem(sys.modules, 'laya', SimpleNamespace(Router=Router))
    monkeypatch.setitem(sys.modules, 'laya.common', SimpleNamespace(encode_text=lambda *args, **kwargs: {'input_ids': [1]}))
    return calls


def test_base_remains_default(monkeypatch):
    calls = fake_runtime(monkeypatch)
    result = LayaDecisionProvider().decide('lunch with Tom')
    assert calls['config']['revision'] == MODEL_REVISION
    assert calls['questions'] == QUESTIONS
    assert not result.experimental


def test_explicit_checkpoint_uses_pilot_policy_and_pinned_digests(monkeypatch, tmp_path):
    calls = fake_runtime(monkeypatch)
    result = LayaDecisionProvider(checkpoint_path=str(tmp_path)).decide('lunch with Tom')
    assert calls['config']['models'] == {'english': str(tmp_path)}
    assert 'revision' not in calls['config']
    assert set(calls['config']['sha256_digests']['english']) == {'model.safetensors', 'rl_agent_config.json', 'encoder/config.json', 'tokenizer/tokenizer.json', 'tokenizer/tokenizer_config.json', 'tokenizer/special_tokens_map.json'}
    assert 'recognizable task shorthand' in calls['questions']['tool_suggestion']['instructions']
    assert result.experimental
    assert result.model == 'predictive-workspace-laya-20261001:calibrated'
    assert result.intent == 'calendar'


def test_missing_checkpoint_fails_without_remote_fallback(monkeypatch, tmp_path):
    calls = fake_runtime(monkeypatch)
    provider = LayaDecisionProvider(checkpoint_path=str(tmp_path / 'missing'))
    with pytest.raises(ProviderUnavailable):
        provider.decide('lunch with Tom')
    assert 'config' not in calls
    assert provider.readiness == 'unavailable'


@pytest.mark.parametrize('artifact', PILOT_DIGESTS)
def test_runtime_verifier_rejects_tampered_inference_artifact(tmp_path, artifact):
    from laya.revisions import verify_digests

    path = tmp_path / artifact
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'tampered inference input')
    with pytest.raises(ValueError, match='SHA-256 mismatch'):
        verify_digests(str(tmp_path), {artifact: PILOT_DIGESTS[artifact]})
    path.unlink()
    with pytest.raises(FileNotFoundError):
        verify_digests(str(tmp_path), {artifact: PILOT_DIGESTS[artifact]})
