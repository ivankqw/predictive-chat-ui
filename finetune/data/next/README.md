# Next dataset review package

This package is staging data. It is not accepted by the pilot training loader.
All workspace labels received agent review. No row has human validation.
The CLINC text is crowdsourced source material. The contrastive text is AI-authored.
Neither source establishes an independent human evaluation set for this project.

## Contents

- `reviewed-clinc.jsonl` preserves original text, source labels, revision, licence and source split.
- `contrastive.jsonl` contains new quotations, adopted quotations, corrections, typos and typing traces.
- `policy.json` defines the proposed annotation policy.
- `clinc-candidates.jsonl` preserves the pinned extraction pool used to verify every reviewed source row.
- `source.json` records the candidate-pool hash, selection and attribution.
- `manifest.json` records hashes and reproducible counts.
- `CLINC-LICENSE.txt` preserves the source licence.

The review covers the first eight candidates per source label.
This convenience sample establishes annotation problems. It is not representative of traffic.
Excluded rows have no workspace label and cannot supply a training target.

CLINC calendar queries often request existing events rather than new event drafts.
CLINC reminder queries often request existing reminders rather than new tasks.
These requests receive `none` because the app cannot retrieve that state.
Deletion requests remain excluded while product behavior is undecided.
Message requests support a draft, not permission to send.

Source attribution is Larson et al., *An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction*, EMNLP 2019.
See <https://aclanthology.org/D19-1131/> and <https://github.com/clinc/oos-eval>.
Original source text is unchanged. Workspace labels and review metadata are additions.

## Proposed policy change

`proactive-v2-draft` distinguishes a quoted request from an explicitly adopted quotation.
It also clarifies unsupported retrieval and unfinished conditions.
It is not the active `proactive-v1` policy.
The frozen pilot policy, data and splits remain unchanged.

Use the same approved policy in training and serving.
Recalibrate and evaluate whenever that policy changes.
Do not transfer the pilot thresholds or quality claims to this policy.

## Audit

From the repository root, run:

```bash
python -m finetune.next_data verify
python -m pytest finetune/tests/test_next_data.py -q
```

After an intentional source edit, regenerate the manifest and review the diff:

```bash
python -m finetune.next_data manifest
```

The audit rejects duplicate normalized text, pilot overlap, changed policies and unsupported review statuses.
It also rejects upstream holdout rows and claims of human validation.
The audit verifies the extraction pool against a pinned SHA-256 and matches each reviewed CLINC ID, text and source field against that pool. A passing audit verifies structure and source integrity, not annotation correctness.

## Future split design

Keep all these candidates training-only until the policy and labels are approved.
Keep the old pilot test frozen as a regression set. Its errors have already been examined.

For new source material, assign original groups before generating variants.
Keep every quotation, correction, paraphrase and typing trace with its source group.
CLINC does not provide original scenario families in this extraction.
The conservative CLINC groups use source intent and remain training-only.
Do not split similar requests at random and call them independent evaluation.

Create validation and calibration groups separately from training groups.
Use validation for model selection and thresholds. Use calibration only for probability calibration.
Reserve a new final holdout written independently of these examples and their author.
Human review of agent-written examples does not make their authorship independent.
Record that holdout's provenance and keep its results out of iteration decisions.

Do not fabricate soft target probabilities from one agent's confidence.
Record disagreements before deciding whether to adjudicate labels or collect multiple independent judgments.
The next training adapter must enforce these group and policy boundaries before consuming this package.
