# Predictive workspace evaluation

These are synthetic, authored cases, not a production benchmark or a Jev comparison.
The case file was frozen before the model service results were read.
The exploratory development suite selected the English Laya checkpoint and the score gate.
No prompt or threshold changes used this evaluation set.

## Reproduce

Start the local decision service and send one warmup request. From the repository root:

```bash
python3 docs/experiment/evaluate_http.py \
  --cases docs/experiment/heldout-cases.json \
  --output /tmp/predictive-workspace-results.json
```

The script performs real HTTP inference. It uses no expected-answer fixtures as model responses.
Raw responses and request wall times are in `heldout-results.json`.
The first request in a separate fresh service process is in `cold-start.json`.
That cold measurement used an existing model cache and excludes downloading weights.

## Laya result

Measured 2026-09-30 on an Apple M1 Pro, 16 GiB memory, MPS, Python 3.12.7.
Package `laya==0.3.21`; English checkpoint revision `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`.
The gate requires a top score of 0.45 and a margin of 0.15.

| Measurement | Result |
| --- | --- |
| Raw top-choice matches | 18 / 30 |
| Matches after abstention gate | 17 / 30 |
| Correct suggestions / all suggestions | 12 / 17 |
| Correct suggestions / actionable prompts | 12 / 20 |
| Unwanted suggestions / no-tool prompts | 5 / 10 |
| Warm model decision median | 83.821 ms |
| Warm HTTP median | 85.483 ms |
| Warm HTTP p95, nearest rank | 292.472 ms |
| First request, weights already cached | 6410.093 ms |
| Multiclass Brier score, raw scores | 0.562079333 |

Source: `heldout-results.json` and `cold-start.json`, produced by the commands above.
Timing includes one pass over varied prompts. It is not an isolated hardware benchmark.
The frontend debounce and rendering are excluded. Other local work can affect timings.
The Brier score is descriptive for this small sample; it does not establish calibration.

The model offered a calendar for `I want to` and `Schedule`.
It offered a message draft for `I do not want a draft email`.
It missed several explicit checklist and comparison requests.
These errors are why predictions only offer tools; they do not execute them.
A threshold is not a semantic safety guarantee.

The old Groq generation path was not benchmarked. Do not infer a speedup over it or over Jev.
