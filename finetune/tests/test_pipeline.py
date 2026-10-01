import copy
import json
import shutil

import pytest

from finetune.data_tools import ROOT, grouped_split, read_rows, validate, verify_splits, write_splits
from finetune.metrics import report, select_gate
from finetune.policy import LABELS


def test_frozen_manifest_and_group_isolation():
    manifest = verify_splits(ROOT / "data/splits")
    assert manifest["counts"] == {"train": 141, "validation": 47, "calibration": 47, "test": 47}
    rows = read_rows(ROOT / "data/seed.jsonl")
    splits = grouped_split(rows)
    assert grouped_split(list(reversed(rows))) == splits
    for split in splits:
        assert splits[split] == read_rows(ROOT / f"data/splits/{split}.jsonl")
        negative_tags = {tag for r in splits[split] if r["family_label"] == "none" for tag in r["tags"]}
        assert negative_tags == {"negation", "partial", "topic_question", "conversation", "quoted"}


def test_split_tampering_and_no_refreeze(tmp_path):
    target = tmp_path / "splits"
    shutil.copytree(ROOT / "data/splits", target)
    with (target / "test.jsonl").open("a") as file:
        file.write("\n")
    with pytest.raises(ValueError, match="Frozen split changed"):
        verify_splits(target)
    with pytest.raises(ValueError, match="Refusing"):
        write_splits(ROOT / "data/seed.jsonl", target)


@pytest.mark.parametrize("mutation", ("duplicate_text", "nan", "wrong_label", "sequence_leak"))
def test_bad_data_rejected(mutation):
    rows = copy.deepcopy(read_rows(ROOT / "data/seed.jsonl"))
    if mutation == "duplicate_text":
        rows[1]["text"] = "  " + rows[0]["text"].upper() + "  "
    elif mutation == "nan":
        rows[0]["target"]["calendar"] = float("nan")
    elif mutation == "wrong_label":
        rows[0]["label"] = "none"
    else:
        rows[4]["typing_sequence"] = rows[0]["typing_sequence"]
    with pytest.raises(ValueError):
        grouped_split(rows)


def predictions():
    rows = []
    for id_, label, selected in (("right", "calendar", "calendar"), ("negative", "none", "calendar")):
        p = {k: .025 for k in LABELS}
        p[selected] = .9
        rows.append({"id": id_, "label": label, "probabilities": p, "target": {k: float(k == label) for k in LABELS},
                     "tags": ["explicit" if label != "none" else "negation"], "decision_ms": 10.0})
    return rows


def test_report_counts_false_suggestions_and_gate_can_abstain():
    rows = predictions()
    result = report(rows, {"top": .45, "margin": .15})
    assert result["raw_accuracy"] == .5
    assert result["false_suggestions_on_none"] == 1
    assert result["selective_risk"] == .5
    assert result["slices"]["negation"]["false_suggestion_rate"] == 1
    gate = select_gate(rows, "validation")
    gated = report(rows, gate)
    assert gated["suggestions"] == 0
    assert gated["selective_risk"] is None


def test_test_split_cannot_select_gate():
    with pytest.raises(ValueError, match="validation"):
        select_gate(predictions(), "test")


def test_invalid_predictions_fail():
    rows = predictions()
    rows[0]["probabilities"]["calendar"] = 1.9
    with pytest.raises(ValueError, match="Invalid prediction"):
        report(rows, {"top": .45, "margin": .15})
