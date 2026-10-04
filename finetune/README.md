# Prepare Laya fine-tuning

This package prepares a local five-choice model for suggesting editable tools before Send. It does not replace the production model or run tools automatically. Start with the [Colab notebook](predictive_workspace_colab.ipynb) on one GPU. GPU training has **not** been executed here; no improved accuracy or latency is claimed.

## Implementation brief and source

The target is useful shorthand such as `lunch with Tom` and `lucnh with Tom` without suggestions for negations, quoted requests, topic questions, or incomplete fragments. Production currently asks for explicit requests, so this changes the experimental labeling policy as well as preparing weight adaptation. The same proactive question is used for the baseline and adapted-model comparison; a production-question baseline is a separate diagnostic.

The RLCD proper-scoring reward plus cross-entropy loss, exploration schedule, encoder/head learning rates and gradient checkpointing follow [Laya's notebook](https://github.com/NandhaKishorM/laya/blob/6d942c92081fbc139e736bbd9ac0023223c29b7f/notebooks/laya_finetune_typed_decisions_2xT4_kaggle.ipynb), inspected at upstream commit `6d942c92081fbc139e736bbd9ac0023223c29b7f`. This script keeps production's sequence budgets, supports one GPU or DDP, uses smaller batches, and separates calibration from training. The current upstream notebook already holds out calibration items; the earlier handoff described an older version. Our splits additionally isolate scenario families and separate gate selection and final testing.

The runtime stays on production's `laya==0.3.21`; tested dependencies are pinned. The base is `convaiinnovations/laya@55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, with weight SHA256 `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`. All training and inference are local. No Hub upload or hosted generation code is included.

## Labels and data card

`policy.py` defines the experimental question in production's `tool_suggestion` schema. Raw draft text is the state, with no chat-template wrapping. Ordered options are `calendar`, `checklist`, `compare`, `draft_message`, `none`.

| Label | Enough evidence | Insufficient or rejected evidence |
| --- | --- | --- |
| calendar | Explicit scheduling; event activity with a person or time, such as “coffee with Maya Friday” | “Schedule”, “lunch w”, a past event, or negation |
| checklist | Explicit task organization; recognizable list with concrete tasks | An empty “shopping list:” or a question about lists |
| compare | Explicit comparison or named X versus Y alternatives | A missing second alternative; a definition of comparison |
| draft_message | Writing request or recipient plus communicative purpose | Recipient alone, topic discussion, or quoted request |
| none | Conversation, negation, quotation, or insufficient draft | Never turn a topic alone into a current request |

Corrections use the final current intent. Typos retain the intended label when still recognizable. These are authored judgments about **non-executing suggestions**, not permissions to perform an action. Ambiguous prefixes deliberately receive `none`; an independent human audit should revisit borderline cases before larger training runs.

`data/seed.jsonl` contains 282 AI-authored synthetic examples in 78 scenario families, including 48 prefix rows. They were checked for schema and labeling-policy consistency during preparation; an independent human label audit is pending. Positive families contain explicit, shorthand/correction, typo, and prefix examples; negative families cover five scenario classes. Each row has an ID, raw `text`, `label`, ordered-label target distribution, `family_label` for stratification, `scenario_family`, `typing_sequence`, `tags`, `policy_version`, and synthetic provenance. Targets are one-hot pilot labels, **not** calibrated teacher probabilities. No private inbox, bookmarks, or collected keystrokes are used. Variant rows represent a typing scenario family, not observed user trajectories.

Frozen split counts: train 141, validation 47, calibration 47, test 47. SHA256s and the question hash are in `data/splits/manifest.json`. Each negative scenario class is represented in every split. Family IDs and typing sequence IDs cannot cross splits; normalized duplicate text and malformed targets fail validation. The author can see these synthetic test examples; this is a new frozen pilot set, not a blinded real-user holdout. It was finalized before real-model tuning; tiny random-fixture smoke tests are infrastructure tests. Keep `docs/experiment/heldout-results.json` as legacy regression evidence only: it was inspected in prior development and is neither fresh holdout evidence nor training data here.

Do not edit frozen test examples in response to results. For more data, version the policy and dataset, audit new families, freeze a new test set before tuning, and retain previous manifests.

## CPU validation

From the repository root, with Python 3.12:

```bash
python -m venv .venv-finetune
.venv-finetune/bin/python -m pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
.venv-finetune/bin/python -m pip install -r finetune/requirements-cpu.lock
export HF_HOME="$PWD/finetune/outputs/hf-cache"
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
.venv-finetune/bin/python -m finetune.data_tools verify
.venv-finetune/bin/python -m pytest -q finetune/tests
.venv-finetune/bin/python -m finetune.smoke --output finetune/outputs/smoke-new
```

`requirements-cpu.lock` records the complete tested CPU environment, including backend test dependencies. Install it with the PyTorch CPU extra index if refreshing an empty environment. On CUDA use `requirements.txt` after installing `torch==2.6.0` from the CUDA 12.4 index; the CPU lock must not replace a GPU torch build. Add `.venv-finetune/` to your local `.git/info/exclude` if needed; do not commit environments or outputs.

Smoke uses a tiny random BERT encoder and a real Laya decision head. It performs one optimizer step, fits choice temperature on calibration rows, exports and reloads through `Agent`, selects a gate on validation, and evaluates frozen test rows. It checks compatibility and artifact flow, not pretrained-model quality. Output directories must be new; the split freezer refuses overwrites.

## Train on Colab or Kaggle

The Colab notebook creates a separate Python 3.12.13 environment for model commands, including when Colab itself runs Python 3.13. Keep the default kernel; no runtime downgrade is needed. The kernel only orchestrates subprocesses and downloads artifacts.

The notebook installs pinned direct dependencies, verifies the dataset and base weight hash, runs a one-step GPU memory probe, and leaves full training off until `RUN_TRAINING=True`. It does not mount Drive, collect credentials, or publish weights. Save the downloadable artifact zip before an ephemeral session ends.

The same commands work in a checkout on a GPU machine (replace `python` with that environment's interpreter):

```bash
python -m finetune.runtime fetch-base --output finetune/outputs/base
python -m finetune.runtime train --model finetune/outputs/base --device cuda \
  --epochs 1 --max-steps 1 --batch-size 1 --accumulation 1 --output finetune/outputs/probe
python -m finetune.runtime train --model finetune/outputs/base --device cuda \
  --batch-size 1 --accumulation 8 --output finetune/outputs/run-1
python -m finetune.runtime calibrate --model finetune/outputs/run-1/checkpoint_latest \
  --device cuda --output finetune/outputs/calibrated
python -m finetune.runtime evaluate --model finetune/outputs/calibrated --device cuda \
  --split validation --select-gate --output finetune/outputs/adapted-validation
python -m finetune.runtime evaluate --model finetune/outputs/calibrated --device cuda \
  --split test --gate finetune/outputs/adapted-validation/gate.json --output finetune/outputs/adapted-test
```

For Kaggle's two T4s, use the same package and replace the full train command with:

```bash
torchrun --standalone --nproc_per_node=2 -m finetune.runtime train \
  --model finetune/outputs/base --device cuda --batch-size 1 --accumulation 4 \
  --output finetune/outputs/run-1
```

One epoch overwrites only the run's own `checkpoint_latest`; model/config/tokenizer and history survive epoch completion. This is an inference checkpoint, **not** exact optimizer/RNG resume. DDP was source-reviewed but has not been executed here. Reuse base files; never reuse probe weights as the starting model for the full experiment. Calibration and evaluation can run on CPU after training, but before/after latency comparisons require matching hardware, threads and precision.

## Compute advice

Start with one Colab T4 (usually about 16 GB, when allocated), batch 1, accumulation 8, and gradient checkpointing. This is a **trial recommendation**, not a measured memory requirement. Colab GPU type, availability, session lifetime and pricing vary. Upstream documents its full notebook for two T4s; that does not prove this pilot needs two GPUs, and DDP does not combine their memory into one pool.

`probe/training.json` records elapsed time and peak allocated/reserved GPU memory. The probe must complete one optimizer step to exercise Adam state memory. For this 141-row pilot, batch 1/accumulation 8 yields 18 optimizer updates per epoch and 72 over four epochs. Do not extrapolate wall time from checkpoint downloads or the tiny CPU smoke model. Use actual full-run timing; a larger dataset needs its own measurement.

If a T4 OOMs at batch 1 after closing other GPU processes, prefer a 24 GB GPU such as an L4 or a 40 GB A100 before adding more DDP workers. Smaller batches reduce activation memory but not optimizer state. A larger GPU is also useful for repeated experiments; do not pay for one until the trial shows a memory or session-time limitation. No paid compute was provisioned by this task.

## Calibration and evaluation

Only calibration rows fit temperature. The fitter uses the installed serving runtime's temperature bounds (`0.5`–`5` in 0.3.21); inherited `temperature_by_options` is removed so it cannot mask the new fit. Choice is the only trained/calibrated type. Score/noul outputs are out of scope. Exact four-decimal served probabilities are checked after export/reload. Only validation rows select the gate; test rows cannot select it. The pilot gate maximizes coverage among candidates with no observed false suggestions on validation `none` and at most 10% wrong suggestions. This small synthetic sample gives no statistical safety guarantee; zero coverage is explicitly reported with undefined selective risk.

Before training, evaluate the pinned base on the same proactive policy:

```bash
python -m finetune.runtime evaluate --model finetune/outputs/base --device cuda \
  --split validation --select-gate --output finetune/outputs/base-validation
python -m finetune.runtime evaluate --model finetune/outputs/base --device cuda \
  --split test --gate finetune/outputs/base-validation/gate.json --output finetune/outputs/base-test
python -m finetune.compare --before finetune/outputs/base-test/report.json \
  --after finetune/outputs/adapted-test/report.json --output finetune/outputs/comparison.json
```

Reports include per-label precision/recall, false suggestions on none/negations, shorthand/typo recall, coverage, selective risk, Brier score, NLL, 10-bin ECE, and warm median/p95 decision latency. They preserve sample IDs, slice support, artifact hashes, policy, split hashes, precision and hardware. Comparison refuses mismatched experiments. Both gates are chosen independently on validation; also report a fixed production-gate comparison if needed by evaluating both test sets without `--gate`. `--policy production` is a diagnostic for the old question, not an apples-to-apples weight comparison.

## Export, integration and rollback

`calibrated/` contains a standard Laya local checkpoint plus `artifact.json` hashes and provenance in `rl_agent_config.json`. Reload with `laya.Agent('/absolute/path/calibrated', device='cpu')` and call `system_one(text, finetune.policy.QUESTIONS)`. Keep the calibrated question and gate with the weights; changing the question invalidates the measured result.

Production integration is a separate opt-in change: add a validated absolute `LAYA_MODEL_DIR` path, use `Agent` only when set, verify artifact hashes before loading, and select the proactive question and exported gate together. Keep the pinned base `Router` and existing question when unset. Require matching five-label shape, input limits and failure behavior. Do not silently activate a checkpoint because a folder exists. Roll back by unsetting the override and restarting the service. No model-directory override is added to the current app in this preparation PR.

## Validation status

Prepared here: data/schema/leakage tests; real Laya APIs on the offline tiny fixture; export/reload; calibration persistence; validation gate and test metrics. Existing frontend lifecycle/ICS and chat route tests pass. Backend contract tests pass outside the restricted sandbox; its TestClient loop timed out inside it. No production code was changed.

The real pinned checkpoint download returned a proxy `403` for `huggingface.co`. Real-model baselines, GPU memory probes, full training, DDP and an executed Colab session remain unrun. Colab does not depend on this cloud machine's network policy. The blog and existing draft PRs remain unpublished; do not insert fine-tune quality claims until actual reports exist.

## Next experiment preparation

See [ABLATION.md](ABLATION.md) for supervised-only versus RLCD training.
See [the next dataset package](data/next/README.md) for agent-reviewed candidates and the draft policy.
The next package is staging data. It does not replace the frozen pilot splits.
