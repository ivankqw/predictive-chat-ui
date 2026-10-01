"""Compare compatible real-model reports, refusing mismatched experiments."""

import argparse
import json
from pathlib import Path


def compare(before, after):
    for key in ("split", "split_sha256", "policy_sha256", "hardware"):
        if before["metadata"][key] != after["metadata"][key]:
            raise ValueError(f"Reports differ in {key}; rerun with matching conditions")
    if before["metadata"]["split"] != "test":
        raise ValueError("Final comparison requires frozen test reports")
    names = ("raw_accuracy", "coverage", "selective_risk", "false_suggestion_rate_on_none",
             "brier", "nll", "ece_10_bins", "decision_ms_median", "decision_ms_p95")
    return {"status": "measured synthetic pilot; no population quality claim",
            "before": before, "after": after,
            "deltas": {k: after["metrics"][k] - before["metrics"][k]
                       if after["metrics"][k] is not None and before["metrics"][k] is not None else None for k in names}}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--before", type=Path, required=True)
    p.add_argument("--after", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    if args.output.exists():
        raise ValueError("Refusing to replace a report")
    args.output.write_text(json.dumps(compare(json.loads(args.before.read_text()), json.loads(args.after.read_text())), indent=2) + "\n")


if __name__ == "__main__":
    main()
