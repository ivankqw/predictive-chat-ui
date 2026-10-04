# Supervised versus RLCD experiment

The training command now accepts `--objective supervised` or `--objective rlcd`.
The default remains `rlcd`, which combines the original policy-gradient term and supervised cross-entropy.
The supervised arm removes the policy-gradient term. Both arms train the same model parameters.
Neither arm trains the separate act output. Its zero-valued term retains the original graph behavior.

Each run records its objective in training history and checkpoint metadata.
Both arms use the same pinned initial checkpoint, split manifest, example order and optimizer settings.
RL perturbations use a separate seeded generator. They do not consume the model's dropout random stream.
This changes the old RL random stream, so new runs cannot exactly reproduce the earlier pilot trajectory.
The model and data seed remain fixed. GPU kernels can still introduce nondeterminism.

## Existing pilot comparison

These commands use the frozen pilot data. They do not consume `data/next`.
Use fresh output directories. Never initialize the second arm from the first arm's checkpoint.
Execute only on the existing authorized Colab GPU session.

```bash
python -m finetune.runtime train --model finetune/outputs/base \
  --objective supervised --device cuda --batch-size 1 --accumulation 8 \
  --epochs 4 --output finetune/outputs/ablation-supervised
python -m finetune.runtime train --model finetune/outputs/base \
  --objective rlcd --device cuda --batch-size 1 --accumulation 8 \
  --epochs 4 --output finetune/outputs/ablation-rlcd
```

Apply the existing calibration and evaluation commands separately to each arm.
Fit temperature on calibration rows only. Choose each gate on validation rows only.
Compare held-out NLL, Brier score, useful coverage and wrong-suggestion rates.
Also compare both models under the same predeclared suggestion threshold.
Do not compare training losses across objectives; they optimize different quantities.

The pilot test is now a regression set, not an untouched final test.
A win there cannot establish real-user generalization or safe automation.
The next experiment needs independently authored realistic evaluation data.
It also needs validation after each epoch to diagnose overfitting.
The current runtime still saves only the latest checkpoint and does not perform per-epoch validation.
Do not claim a learning-curve diagnosis from its final evaluation.

## Verification scope

CPU tests exercise target-directed gradients, masked options, deterministic perturbations and random-stream isolation.
The tiny offline fixture exercises training, calibration, reload and evaluation.
It cannot establish real-model accuracy, CUDA equivalence or memory requirements.
No new GPU training is part of this code change.
