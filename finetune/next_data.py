"""Audit the next training candidate package without altering frozen pilot splits."""

import argparse
from collections import Counter
import json
from pathlib import Path

from .data_tools import ROOT, canonical, digest, read_rows, verify_splits
from .policy import LABELS

PACKAGE = ROOT / "data/next"
FILES = ("reviewed-clinc.jsonl", "contrastive.jsonl", "policy.json", "source.json", "CLINC-LICENSE.txt", "clinc-candidates.jsonl")
POOL_SHA256 = "829adc0f9c7f8bb4ce934ee08864d84cb31c7222a98da9cfda261852b64e758a"
SOURCE_FIELDS = ("id", "text", "source_label", "source_split", "source_family_id", "source", "revision", "license")


def audit(directory=PACKAGE):
    directory = Path(directory)
    source = json.loads((directory / "source.json").read_text())
    if source.get("candidate_pool_sha256") != POOL_SHA256 or digest(directory / "clinc-candidates.jsonl") != POOL_SHA256:
        raise ValueError("Candidate source pool hash mismatch")
    originals = {row["id"]: row for row in read_rows(directory / "clinc-candidates.jsonl")}
    source_texts = {canonical(row["text"]) for row in originals.values()}
    pilot = verify_splits(ROOT / "data/splits")
    policy = json.loads((directory / "policy.json").read_text())
    if policy["version"] != "proactive-v2-draft" or set(policy["labels"]) != set(LABELS):
        raise ValueError("Unknown proposed policy")
    frozen_text = {canonical(r["text"]) for split in pilot["counts"]
                   for r in read_rows(ROOT / f"data/splits/{split}.jsonl")}
    source_rows = read_rows(directory / "reviewed-clinc.jsonl")
    synthetic_rows = read_rows(directory / "contrastive.jsonl")
    rows = source_rows + synthetic_rows
    if not rows:
        raise ValueError("Empty review package")
    ids, texts, sequences = set(), set(), {}
    for row, is_source in [(row, True) for row in source_rows] + [(row, False) for row in synthetic_rows]:
        if not isinstance(row.get("id"), str) or not row["id"] or row["id"] in ids:
            raise ValueError("Missing or duplicate id")
        ids.add(row["id"])
        if not isinstance(row.get("text"), str) or not canonical(row["text"]):
            raise ValueError("Missing text")
        text = canonical(row["text"])
        if text in texts or text in frozen_text:
            raise ValueError("Duplicate text or frozen pilot overlap")
        texts.add(text)
        if row.get("human_validated") is not False or row.get("reviewer") != "codex-agent":
            raise ValueError("Candidate package must not claim human validation")
        if row.get("policy_version") != policy["version"]:
            raise ValueError("Mixed annotation policies")
        if not isinstance(row.get("leakage_group"), str) or not row["leakage_group"]:
            raise ValueError("Missing leakage group")
        status = row.get("review_status")
        if status == "agent_reviewed":
            if row.get("workspace_label") not in LABELS or row.get("allowed_use") != "candidate_training_only":
                raise ValueError("Invalid reviewed candidate")
        elif status == "excluded_pending_policy":
            if row.get("workspace_label") is not None or row.get("allowed_use") != "excluded":
                raise ValueError("Excluded row cannot supply training labels")
        else:
            raise ValueError("Unknown review status")
        if is_source:
            if row.get("source_split") not in ("train", "oos_train"):
                raise ValueError("Upstream holdout cannot enter training candidates")
            if not row.get("review_rationale") or row.get("license") != "CC-BY-3.0":
                raise ValueError("Missing source review or license")
            if row.get("revision") != "828f8093932c8fe6ca7936c3d2e52903b1c523de":
                raise ValueError("Unpinned source revision")
            original = originals.get(row["id"])
            if original is None or any(row.get(key) != original.get(key) for key in SOURCE_FIELDS):
                raise ValueError("CLINC source row mismatch")
        else:
            if text in source_texts:
                raise ValueError("Synthetic text overlaps pinned source pool")
            if not row["id"].startswith("next-synthetic:") or any(key in row for key in SOURCE_FIELDS[2:]):
                raise ValueError("Synthetic row carries invalid source identity")
            if row.get("provenance") != "ai-authored-contrastive-v2" or not row.get("tags"):
                raise ValueError("Unknown synthetic provenance")
            sequence = row.get("typing_sequence")
            if not sequence or not row.get("scenario_family"):
                raise ValueError("Missing synthetic grouping")
            if sequences.setdefault(sequence, row["leakage_group"]) != row["leakage_group"]:
                raise ValueError("Typing sequence spans leakage groups")
    return {
        "status": "agent-reviewed training candidates; human validation pending; no new evaluation split",
        "files": {name: digest(directory / name) for name in FILES},
        "counts": {"total": len(rows), "review_status": dict(sorted(Counter(r["review_status"] for r in rows).items())),
                   "labels": dict(sorted(Counter(r["workspace_label"] for r in rows if r["workspace_label"] is not None).items())),
                   "leakage_groups": len({r["leakage_group"] for r in rows})},
        "frozen_pilot_manifest_sha256": digest(ROOT / "data/splits/manifest.json"),
        "training_allowed": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("manifest", "verify"))
    parser.add_argument("--directory", type=Path, default=PACKAGE)
    args = parser.parse_args()
    report = audit(args.directory)
    path = args.directory / "manifest.json"
    if args.command == "manifest":
        path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    elif json.loads(path.read_text()) != report:
        raise ValueError("Candidate manifest mismatch")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
