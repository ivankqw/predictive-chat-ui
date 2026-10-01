"""Validate synthetic rows and freeze deterministic scenario-isolated splits."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import unicodedata

from .policy import LABELS, QUESTIONS

ROOT = Path(__file__).parent
SPLITS = ("train", "validation", "calibration", "test")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_rows(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def canonical(text):
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def validate(rows):
    if not rows:
        raise ValueError("Empty dataset")
    ids, texts = set(), set()
    for row in rows:
        if not isinstance(row.get("id"), str) or not row["id"] or row["id"] in ids:
            raise ValueError("Missing or duplicate id")
        ids.add(row["id"])
        text = row.get("text")
        if not isinstance(text, str) or not canonical(text) or canonical(text) in texts:
            raise ValueError("Empty or duplicate normalized text")
        texts.add(canonical(text))
        for key in ("scenario_family", "typing_sequence", "provenance", "policy_version"):
            if not isinstance(row.get(key), str) or not row[key]:
                raise ValueError(f"Missing {key}")
        if row["provenance"] != "synthetic-authored-v1" or row["policy_version"] != "proactive-v1":
            raise ValueError("Unknown provenance or labeling policy")
        if row.get("label") not in LABELS or row.get("family_label") not in LABELS:
            raise ValueError("Unknown label")
        if not isinstance(row.get("tags"), list) or not row["tags"]:
            raise ValueError("Missing tags")
        target = row.get("target")
        if not isinstance(target, dict) or set(target) != set(LABELS):
            raise ValueError("Targets must contain exactly the five labels")
        values = list(target.values())
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in values):
            raise ValueError("Invalid target distribution")
        if not math.isclose(sum(values), 1.0, abs_tol=1e-9):
            raise ValueError("Target must sum to one")
        if target[row["label"]] != max(values) or values.count(max(values)) != 1:
            raise ValueError("Label must be unique target maximum")


def grouped_split(rows, seed=42):
    validate(rows)
    groups = {}
    sequences = {}
    for row in rows:
        family = row["scenario_family"]
        groups.setdefault(family, []).append(row)
        previous = sequences.setdefault(row["typing_sequence"], family)
        if previous != family:
            raise ValueError("Typing sequence spans scenario families")
    strata = {}
    for family, members in groups.items():
        labels = {r["family_label"] for r in members}
        if len(labels) != 1:
            raise ValueError("Inconsistent family label")
        label = next(iter(labels))
        # Each negative scenario class needs support in every split.
        stratum = (label, members[0]["tags"][0]) if label == "none" else (label,)
        if label == "none" and len({tuple(r["tags"]) for r in members}) != 1:
            raise ValueError("Negative family tags must be consistent")
        strata.setdefault(stratum, []).append(family)
    out = {split: [] for split in SPLITS}
    rng = random.Random(seed)
    for stratum in sorted(strata):
        families = strata[stratum]
        families.sort()
        if len(families) < 6:
            raise ValueError("At least six independent families per label are required")
        rng.shuffle(families)
        n = max(1, len(families) // 6)
        assignments = dict(zip(families[:n], ["test"] * n))
        assignments.update(dict.fromkeys(families[n:2*n], "calibration"))
        assignments.update(dict.fromkeys(families[2*n:3*n], "validation"))
        for family in families:
            out[assignments.get(family, "train")].extend(groups[family])
    for split in out:
        out[split].sort(key=lambda r: r["id"])
    return out


def write_splits(source, output):
    rows = read_rows(source)
    splits = grouped_split(rows)
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Refusing to replace a frozen split directory")
    output.mkdir(parents=True, exist_ok=True)
    files = {}
    for split, members in splits.items():
        path = output / f"{split}.jsonl"
        path.write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in members))
        files[path.name] = digest(path)
    manifest = {
        "seed": 42, "source_sha256": digest(source), "files": files,
        "policy_sha256": hashlib.sha256(json.dumps(QUESTIONS, sort_keys=True).encode()).hexdigest(),
        "counts": {s: len(r) for s, r in splits.items()},
        "status": "frozen synthetic pilot; authored examples, not real-user validation",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def verify_splits(directory):
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    policy_hash = hashlib.sha256(json.dumps(QUESTIONS, sort_keys=True).encode()).hexdigest()
    if manifest["policy_sha256"] != policy_hash:
        raise ValueError("Frozen policy changed")
    families, sequences, rows = {}, {}, []
    for split in SPLITS:
        name = f"{split}.jsonl"
        if digest(directory / name) != manifest["files"][name]:
            raise ValueError(f"Frozen split changed: {name}")
        members = read_rows(directory / name)
        if len(members) != manifest["counts"][split]:
            raise ValueError("Manifest count mismatch")
        for row in members:
            for key, seen in (("scenario_family", families), ("typing_sequence", sequences)):
                if seen.setdefault(row[key], split) != split:
                    raise ValueError(f"{key} leaks across splits")
        rows.extend(members)
    validate(rows)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("freeze", "verify"))
    parser.add_argument("--source", type=Path, default=ROOT / "data/seed.jsonl")
    parser.add_argument("--splits", type=Path, default=ROOT / "data/splits")
    args = parser.parse_args()
    result = write_splits(args.source, args.splits) if args.command == "freeze" else verify_splits(args.splits)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
