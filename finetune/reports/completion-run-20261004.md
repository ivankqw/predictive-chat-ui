# Data and objective implementation ledger

Scope is candidate annotation and supervised-versus-RLCD experiment support.
No paid API or GPU training is authorized by this implementation slice.

## Playbook

- `how` over the affected subsystem. Read policy, splitting, runtime, smoke and tests directly; parent owns orchestration.
- `architect` for parallel design exploration. Skipped because this slice preserves the frozen pilot and adds one objective selector.
- Blocking first steps. Read policy and actual source texts before labeling.
- Independent workstreams. Parent owns app and article work; this worktree owns data and training changes.
- Shared mutable state. Preserve pilot files. Put candidate data in a separate directory.
- Smallest safe decomposition. Keep data schema and audit together; keep objective selection within the existing runtime.
- Delegate code-writing. Attempted a scoped objective delegate; tool rejected the thread limit. Parent supplies independent review separation.
- Verify on the matching surface. Run CPU tests, candidate audit and the offline fixture pipeline.
- Rebase into small, ordered commits. Parent owns integration and commits; no push from this slice.
- If the design is contested, interrogate before shipping. No contested design identified.
- Run Opening a PR. Parent owns review and publication.

## Interface audit

`runtime train` adds an optional objective flag. Existing notebook and smoke commands retain the RLCD default.
Python callers without an objective attribute retain the RLCD default.
`rlcd_loss` adds an optional generator. Existing direct callers remain valid.
The new data audit is separate from the old split loader. It cannot activate the draft annotation policy.
The runtime records extra metadata without removing existing fields.
No notebook, production predictor, frozen split, or frozen policy changed.

## Checks

See the parent run record for command output and independent review.
The implementer checks structure and arithmetic; annotation quality still requires independent review.

## Implementer results

- `python -m pytest finetune/tests -q` returned `21 passed`.
- `python -m finetune.next_data verify` reproduced the saved candidate manifest.
- Manifest counts are 128 rows, 109 agent-reviewed labels and 19 exclusions.
- The source review covers 80 CLINC rows. The AI-authored file contains 48 rows.
- `python -m finetune.smoke --output /tmp/predictive-objective-smoke-clamp-20261004` passed the offline fixture pipeline.
- A separate supervised fixture run completed one optimizer update.
- Checkpoint metadata matched initial weight hash, seed, steps and split manifest across both fixture arms.
- The temperature boundary test failed before the fix because `0.4999999701976776 < 0.5`.
- It passed after clamping to the serving temperature bounds.
- The smoke run after the fix emitted no invalid-temperature warning.

These measurements used the existing local decision virtual environment.
Installed versions were Python 3.12, Laya 0.3.21, Torch 2.14.0, Transformers 5.17.0 and pytest 9.1.1.
Torch and Transformers differ from the Colab package pins. Pinned-environment and CUDA validation remain unverified.
No real checkpoint was trained. No file was pushed.

## Independent review correction

The first audit trusted self-declared CLINC provenance. The corrected package includes the original pinned extraction pool and verifies every reviewed source field against it. Fabricated IDs, changed text, changed source labels and altered pool bytes are rejected. [Measured: final `python -m pytest finetune/tests -q` completed with 28 passing tests in the local environment described above.]

The source versus synthetic boundary is determined by the input file, not a mutable row ID prefix. Synthetic rows must use their own namespace and cannot carry CLINC source fields.
