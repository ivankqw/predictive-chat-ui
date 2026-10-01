# Before / after experiment report

Status: unrun. Fill from real-model artifacts, never the tiny smoke checkpoint.

- Source commit, dataset/policy manifest hashes, base weight revision/hash:
- Adapted artifact and config hashes; calibration split and fitted temperature:
- Hardware, precision, thread count, GPU peak allocated/reserved bytes:
- Baseline and adapted gate, selected on validation only:
- Raw accuracy; per-label precision/recall and support:
- None, negation, quotation and topic-question false suggestions:
- Short-draft and typo recall; incomplete-prefix behavior:
- Coverage and selective risk, including zero-coverage cases:
- Brier, NLL and ECE with sample count and bin definition:
- Warm median/p95 latency on matching hardware; download/load excluded:
- Failures, unsupported slices, dataset limitations, and independent human audit:
- Recommendation: retain base / collect more data / opt-in adapted checkpoint.

Synthetic pilot results do not establish performance on real drafts. Legacy app results are regression context only. Do not choose a new gate or retrain against the frozen test outcomes.
