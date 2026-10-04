"""Frozen policy from the 2026-10-01 pilot archive."""

LABELS = ("calendar", "checklist", "compare", "draft_message", "none")
QUESTIONS = {
    "tool_suggestion": {
        "type": "choice",
        "instructions": (
            "Suggest one non-executing editable workspace tool for this current draft. "
            "An explicit request or recognizable task shorthand can warrant a suggestion, "
            "including typos. Prefer none for topic-only questions, negations, quoted requests, "
            "or fragments without enough evidence. For corrections use the final current intent."
        ),
        "criteria": {
            "calendar": "An event draft: scheduling or changing an event, or event shorthand with an activity and person or time.",
            "checklist": "A task list: a request to organize tasks or recognizable task/reminder/list shorthand.",
            "compare": "A comparison table: comparing at least two alternatives or a recognizable X versus Y draft.",
            "draft_message": "A message editor: writing, replying to, or editing a message, or recipient plus communicative purpose shorthand.",
            "none": "No useful current tool request: general conversation, topic-only questions, negation, quoted speech, or an insufficient fragment.",
        },
    }
}
