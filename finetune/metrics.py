"""Gate selection and reporting; test labels are never used to choose a gate."""

import math
import statistics

from .policy import LABELS


def check_predictions(rows):
    if not rows:
        raise ValueError("No predictions")
    seen = set()
    for row in rows:
        if row["id"] in seen or row["label"] not in LABELS:
            raise ValueError("Invalid prediction identity")
        seen.add(row["id"])
        p = row["probabilities"]
        if set(p) != set(LABELS) or any(not math.isfinite(v) or not 0 <= v <= 1 for v in p.values()):
            raise ValueError("Invalid prediction distribution")
        # Five probabilities are rounded to four decimals by the serving API.
        if not math.isclose(sum(p.values()), 1, abs_tol=0.0003):
            raise ValueError("Prediction probabilities must sum to one")


def gated(row, top, margin):
    p = row["probabilities"]
    choice = max(LABELS, key=p.__getitem__)
    ranked = sorted(p.values(), reverse=True)
    return choice if choice != "none" and ranked[0] >= top and ranked[0] - ranked[1] >= margin else "none"


def report(rows, gate):
    check_predictions(rows)
    choices = [max(LABELS, key=r["probabilities"].__getitem__) for r in rows]
    selected = [gated(r, gate["top"], gate["margin"]) for r in rows]
    n = len(rows)
    correct = sum(c == r["label"] for c, r in zip(choices, rows))
    suggestions = sum(c != "none" for c in selected)
    wrong = sum(c != "none" and c != r["label"] for c, r in zip(selected, rows))
    none_count = sum(r["label"] == "none" for r in rows)
    false_suggestions = sum(c != "none" and r["label"] == "none" for c, r in zip(selected, rows))
    ece = 0.0
    for bin_id in range(10):
        indices = [i for i, r in enumerate(rows) if min(9, int(max(r["probabilities"].values()) * 10)) == bin_id]
        if indices:
            accuracy = sum(choices[i] == rows[i]["label"] for i in indices) / len(indices)
            confidence = sum(max(rows[i]["probabilities"].values()) for i in indices) / len(indices)
            ece += len(indices) / n * abs(accuracy - confidence)
    per_label = {}
    for label in LABELS:
        indices = [i for i, r in enumerate(rows) if r["label"] == label]
        predicted = sum(c == label for c in selected)
        tp = sum(selected[i] == label for i in indices)
        per_label[label] = {"support": len(indices), "precision": tp / predicted if predicted else None,
                            "recall": tp / len(indices) if indices else None}
    slices = {}
    for tag in sorted({tag for r in rows for tag in r["tags"]}):
        indices = [i for i, r in enumerate(rows) if tag in r["tags"]]
        useful = [i for i in indices if rows[i]["label"] != "none"]
        negative = [i for i in indices if rows[i]["label"] == "none"]
        slices[tag] = {
            "support": len(indices),
            "useful_tool_recall": sum(selected[i] == rows[i]["label"] for i in useful) / len(useful) if useful else None,
            "false_suggestion_rate": sum(selected[i] != "none" for i in negative) / len(negative) if negative else None,
        }
    latencies = sorted(r["decision_ms"] for r in rows)
    return {
        "count": n, "raw_accuracy": correct / n,
        "coverage": suggestions / n, "suggestions": suggestions,
        "wrong_suggestions": wrong, "selective_risk": wrong / suggestions if suggestions else None,
        "none_support": none_count, "false_suggestions_on_none": false_suggestions,
        "false_suggestion_rate_on_none": false_suggestions / none_count if none_count else None,
        "brier": sum(sum((r["probabilities"][k] - r["target"][k]) ** 2 for k in LABELS) for r in rows) / n,
        "nll": -sum(sum(r["target"][k] * math.log(max(r["probabilities"][k], 1e-12)) for k in LABELS) for r in rows) / n,
        "ece_10_bins": ece, "per_label": per_label, "slices": slices,
        "decision_ms_median": statistics.median(latencies),
        "decision_ms_p95": latencies[max(0, math.ceil(.95 * n) - 1)],
        "gate": gate,
    }


def select_gate(rows, split):
    if split != "validation":
        raise ValueError("Gates may only be selected on validation")
    candidates = []
    for top in (0.0, .35, .45, .55, .65, .75, .85, .95, 1.0):
        for margin in (0.0, .1, .15, .25, .4, 1.0):
            gate = {"top": top, "margin": margin}
            result = report(rows, gate)
            # Pilot policy: no observed false suggestions on none and <=10% wrong suggestions.
            # Small synthetic supports provide no population-level guarantee.
            if result["false_suggestions_on_none"] == 0 and (result["selective_risk"] or 0) <= .1:
                candidates.append((result["suggestions"], -top, -margin, gate))
    return max(candidates, key=lambda r: r[:3])[3]
