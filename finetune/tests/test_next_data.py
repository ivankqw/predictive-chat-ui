import json
import shutil

import pytest

from finetune.next_data import PACKAGE, audit


def test_manifest_reproduces_and_does_not_claim_holdout():
    report = audit()
    assert report == json.loads((PACKAGE / "manifest.json").read_text())
    assert report["training_allowed"] is False
    assert report["counts"]["review_status"]["excluded_pending_policy"] > 0


@pytest.mark.parametrize("mutation,expected", [
    ("human", "human validation"), ("holdout", "holdout"),
    ("label_excluded", "Excluded row"), ("duplicate", "Duplicate text"),
    ("policy", "Mixed annotation"), ("sequence", "Typing sequence"),
])
def test_review_guard_rejects_bad_candidates(tmp_path, mutation, expected):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    file = target / ("contrastive.jsonl" if mutation == "sequence" else "reviewed-clinc.jsonl")
    rows = [json.loads(line) for line in file.read_text().splitlines()]
    if mutation == "human":
        rows[0]["human_validated"] = True
    elif mutation == "holdout":
        rows[0]["source_split"] = "test"
    elif mutation == "label_excluded":
        assert rows[0]["review_status"] == "excluded_pending_policy"
        rows[0]["workspace_label"] = "checklist"
    elif mutation == "duplicate":
        rows[1]["text"] = "  " + rows[0]["text"].upper()
    elif mutation == "policy":
        rows[0]["policy_version"] = "proactive-v1"
    else:
        rows[1]["typing_sequence"] = rows[0]["typing_sequence"]
        rows[1]["leakage_group"] = "other"
    file.write_text("".join(json.dumps(r) + "\n" for r in rows))
    with pytest.raises(ValueError, match=expected):
        audit(target)


@pytest.mark.parametrize("field,value", [("id", "clinc150:train:999999"), ("text", "THIS IS NOT CLINC SOURCE TEXT"), ("source_label", "invented")])
def test_source_row_tampering_is_rejected(tmp_path, field, value):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    file = target / "reviewed-clinc.jsonl"
    rows = [json.loads(line) for line in file.read_text().splitlines()]
    rows[0][field] = value
    file.write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError, match="CLINC source row mismatch"):
        audit(target)


def test_source_pool_tampering_is_rejected(tmp_path):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    with (target / "clinc-candidates.jsonl").open("a") as stream:
        stream.write("\n")
    with pytest.raises(ValueError, match="source pool hash"):
        audit(target)


def test_source_cannot_masquerade_as_synthetic(tmp_path):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    file = target / "reviewed-clinc.jsonl"
    rows = [json.loads(line) for line in file.read_text().splitlines()]
    rows[0].update(id="next-synthetic:crafted", provenance="ai-authored-contrastive-v2",
                   tags=["crafted"], typing_sequence="crafted", scenario_family="crafted")
    file.write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError, match="CLINC source row mismatch"):
        audit(target)


def test_synthetic_file_rejects_source_identity(tmp_path):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    file = target / "contrastive.jsonl"
    rows = [json.loads(line) for line in file.read_text().splitlines()]
    rows[0]["source"] = "https://github.com/clinc/oos-eval"
    file.write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError, match="invalid source identity"):
        audit(target)


def test_synthetic_cannot_relabel_source_text(tmp_path):
    target = tmp_path / "next"
    shutil.copytree(PACKAGE, target)
    source = target / "reviewed-clinc.jsonl"
    source_rows = [json.loads(line) for line in source.read_text().splitlines()]
    removed = source_rows.pop(0)
    source.write_text("".join(json.dumps(row) + "\n" for row in source_rows))
    file = target / "contrastive.jsonl"
    rows = [json.loads(line) for line in file.read_text().splitlines()]
    rows[0]["text"] = removed["text"]
    file.write_text("".join(json.dumps(row) + "\n" for row in rows))
    with pytest.raises(ValueError, match="overlaps pinned source pool"):
        audit(target)
