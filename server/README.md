# Predictive workspace server

`decision_app.py` is the local service for predictive workspace suggestions. It classifies a draft into `calendar`, `checklist`, `compare`, `draft_message`, or `none`. It never creates an event, changes a checklist, sends a message, or calls a paid service.

## Run the decision service

Use a dedicated Python 3.12 environment.

```bash
python3.12 -m venv .venv-decision
.venv-decision/bin/python -m pip install -r requirements-decision.txt
.venv-decision/bin/python decision_app.py
```

The service listens on `http://127.0.0.1:8014`.

```bash
curl -s http://127.0.0.1:8014/health
curl -s http://127.0.0.1:8014/api/decision \
  -H 'content-type: application/json' \
  -d '{"text":"Compare the two hotel plans in a table", "request_id":1}'
```

`GET /health` reports `not_loaded`, `ready`, or `unavailable`. It does not load the model. The first decision downloads the model if it is not already in the shared Hugging Face cache.

`POST /api/decision` accepts exactly:

```json
{"text":"Compare the two hotel plans in a table", "request_id":1}
```

The response shape is:

```json
{
  "request_id": 1,
  "intent": "compare",
  "scores": {"calendar": 0.01, "checklist": 0.02, "compare": 0.90, "draft_message": 0.03, "none": 0.04},
  "provider": "laya",
  "model": "convaiinnovations/laya@55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851:english",
  "decision_ms": 12.5,
  "abstained": false
}
```

Scores are raw model probabilities. They are not calibrated confidence. The server preserves all five scores, then returns `intent: "none"` with `abstained: true` if `none` wins, the top score is below 0.45, or its margin is below 0.15. Requests are limited to 600 characters and then checked with the loaded checkpoint tokenizer. The service rejects an input whose state uses more than its actual 312-token state budget, rather than silently truncating it. One decision runs at a time. A request that cannot enter within 50 ms receives HTTP 429, which lets the client retry only its newest draft. An interrupted HTTP request does not release the worker slot until its inference thread has ended. Model-loading and inference errors receive HTTP 503. There is no heuristic, remote model, or old-chat fallback.

The service uses PyPI `laya==0.3.21` with the English checkpoint in `convaiinnovations/laya`, pinned to commit `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`. It checks the downloaded `model.safetensors` SHA-256 against `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c` before parsing it. The package builds the model from local checkpoint configuration. It does not enable Hugging Face remote code.

Development measurements on this Mac used an M1 Pro with 16 GiB memory, MPS, Python 3.13, PyTorch 2.14.0, Transformers 5.17.0, and the same Laya version and model revision. The base English checkpoint had a 139.619 ms median warm decision time across five repeated calls. These are development measurements, not vendor benchmarks and not a guarantee for the Python 3.12 service environment.

The model made useful choices for several direct requests, but it also classified a calendar negation as `calendar` at 0.7636 and a draft-message negation as `draft_message` at 0.5487 in the development suite. The score/margin gate did not make that calendar example safe. Treat this as a non-executing suggestion experiment. Keep the UI's manual selection, dismissal, and explicit tool controls. Do not treat an accepted suggestion as authorization to act.

## Check the decision service

```bash
.venv-decision/bin/python -m pytest -q test_decision_app.py
.venv-decision/bin/python -m py_compile decision_app.py decision_provider.py
```

`test_decision_app.py` stubs the provider. It checks the HTTP contract, request-size validation, and the honest 503 behavior. Install its test dependency with `.venv-decision/bin/python -m pip install -r requirements-decision-dev.txt`. It does not claim a simulated response is model inference.

The frozen held-out HTTP evaluation is stored in `docs/experiment/heldout-results.json`. It measured 18/30 raw top-one choices correct, 17/30 gated results correct, 12 correct suggestions out of 17 suggestions, and 5 unwanted suggestions across 10 expected-none cases. Its median model time was 83.821 ms and median HTTP time was 85.483 ms. `docs/experiment/cold-start.json` measured 6,410.093 ms for the first request after service start using an existing model cache. These are one synthetic evaluation run, not a production-quality claim or a Jev comparison. The frozen evaluation must not tune this prompt or gate.

## Legacy chat server

`main.py` remains the existing optional chat and older intent-detection server. It is separate from the decision service. Its Groq configuration and legacy setup have not been verified for this predictive workspace. Do not use it as a decision fallback.

## Try the local fine-tuned checkpoint

The base model remains the default. To opt into the saved pilot, extract its `calibrated` directory outside this repository. Start the service with an explicit path:

```bash
LOCAL_LAYA_CHECKPOINT=/absolute/path/to/pilot/calibrated \
  .venv-decision/bin/python decision_app.py
```

Restart without `LOCAL_LAYA_CHECKPOINT` to return to the base model. The service never downloads a substitute for a missing local directory. It verifies the pilot weights, root configuration, encoder configuration, and tokenizer files against pinned SHA-256 digests before loading them. This option accepts the saved 2026-10-01 pilot, not arbitrary checkpoints.

The pilot uses its frozen training question and option descriptions from `pilot_policy.py`. This policy permits recognizable task shorthand, including typos. The base model retains its original explicit-request policy. Comparing these modes compares both checkpoint and policy, not weights alone.

The API identifies the pilot as `predictive-workspace-laya-20261001:calibrated` and returns `experimental: true`. The browser marks the fine-tune as experimental beside Prediction details. All tool controls remain editable and require explicit user actions.

This opt-in experiment uses the existing diagnostic gate, with a minimum top score of 0.45 and margin of 0.15. The pilot's stricter validation-selected gate produced zero suggestion coverage. The diagnostic gate is not validated for production. It exposed quotation false positives during the synthetic pilot evaluation. These probabilities include temperature scaling fit on the separate calibration split, but they do not establish calibration on real user drafts. Do not treat a suggested tool as authorization to execute it.

Run provider integration checks without loading weights:

```bash
.venv-decision/bin/python -m pytest -q test_decision_app.py test_checkpoint_provider.py
```

These checks verify default selection, local configuration, pinned digests, policy choice, experiment provenance, and missing-directory failure. They use simulated model output and do not measure model quality.
