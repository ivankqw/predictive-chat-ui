# Predictive workspace

A chat composer that suggests a useful tool while you type. The available tools are an event draft, checklist, comparison table, and message draft.

This revives a small-model hackathon project. The original used Groq to generate JSON for scheduling intent and event details. This experiment uses a local Laya decision model to select a tool. The tools themselves are ordinary editable UI.

## Run locally

Use Node.js 20.9 or newer and Python 3.12. The repository pins 3.12.13; this experiment was tested with the installed 3.12.7 interpreter.

Start the decision service:

```bash
cd server
python3.12 -m venv .venv-decision
.venv-decision/bin/python -m pip install -r requirements-decision.txt
.venv-decision/bin/python decision_app.py
```

In another terminal, start the frontend:

```bash
cd frontend
npm ci
npm run dev -- --port 3014
```

Open http://localhost:3014. The frontend calls the local service at `http://127.0.0.1:8014/api/decision`. Set `DECISION_BACKEND_URL` to override that full endpoint URL.

The first prediction downloads and loads the pinned model. Later predictions reuse it. Model files are cached by Hugging Face. No API key is needed. After the download, decision inference runs locally. The frontend sends your draft to your local backend.

## What the model does

Laya chooses one label: `calendar`, `checklist`, `compare`, `draft_message`, or `none`. The server applies a declared score and margin threshold before offering a suggestion. These scores have not been calibrated on this task.

A suggestion does not execute an action. Open or dismiss it, or choose a tool yourself. Tools keep your edits independently of new predictions. Event files and copied text require explicit clicks. The app does not send messages, write to a calendar account, or invent comparison facts.

The model does not generate the form, populate missing event details, or write message prose. Manual controls remain available if inference fails.

## Jev and System One

[Jev](https://docs.typesafe.ai/concepts/system-one) prompted this experiment. It returns bounded decisions rather than generated prose. We do not have Jev access, so this repository uses [Laya](https://github.com/NandhaKishorM/laya), an available open-weight decision model. This is not a Jev integration or a claim of equivalent quality, training, or speed.

Development probes found unwanted suggestions for explicit negations. A high score does not guarantee that a tool is appropriate. Treat this as an experiment in predictive interaction, not an autonomous action system.

See [the decision service documentation](server/README.md) for the pinned checkpoint, API, tests, and limitations. Evaluation evidence is recorded under `docs/experiment/`.

## Original chat backend

`server/main.py` and the older frontend chat route remain for reference and optional Groq-backed chat. They are separate from the local decision service. Their historical model configuration has not been verified against the current Groq API. The predictive workspace does not need that service.
