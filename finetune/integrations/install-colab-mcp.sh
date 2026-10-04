#!/usr/bin/env bash
# Install on the computer running the Colab browser, not a headless cloud task.
set -euo pipefail

COLAB_MCP_REVISION=b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1
COLAB_MCP_NAME=predictive-chat-colab
COLAB_INSTALL_DIR="${COLAB_INSTALL_DIR:-$HOME/.local/share/predictive-chat-colab-mcp}"
COLAB_SKILL_DIR="${COLAB_SKILL_DIR:-$HOME/.agents/skills/predictive-chat-colab}"

if [ "${1:-}" = "--help" ]; then
  cat <<'HELP'
Run this installer on the computer where you use Colab in your browser.
It installs Google's pinned Colab MCP server with uv, registers it in Codex,
and installs a project-specific Colab workflow skill. It does not log in,
start a GPU runtime, or launch training.

Requires Git and Codex. On macOS, missing uv is installed with Homebrew.
COLAB_INSTALL_DIR and COLAB_SKILL_DIR can override the two installation paths.
HELP
  exit 0
fi
if [ "$#" -ne 0 ]; then
  echo 'Unknown arguments. Use --help.' >&2
  exit 2
fi

if ! command -v git >/dev/null 2>&1; then
  echo 'Git is required. Install the command-line tools, then rerun.' >&2
  exit 1
fi
if command -v codex >/dev/null 2>&1; then
  COLAB_CODEX_BIN="$(command -v codex)"
elif [ -x /Applications/Codex.app/Contents/Resources/codex ]; then
  COLAB_CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
else
  echo 'Codex CLI was not found. Install/enable the CLI from your Codex installation, then rerun.' >&2
  exit 1
fi
if ! command -v uv >/dev/null 2>&1; then
  if [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    brew install uv
  else
    echo 'Install uv using https://docs.astral.sh/uv/getting-started/installation/, then rerun.' >&2
    exit 1
  fi
fi

if [ ! -e "$COLAB_INSTALL_DIR" ]; then
  mkdir -p "$(dirname "$COLAB_INSTALL_DIR")"
  git clone --no-checkout https://github.com/googlecolab/colab-mcp.git "$COLAB_INSTALL_DIR"
elif [ ! -d "$COLAB_INSTALL_DIR/.git" ]; then
  echo "Refusing to replace a non-repository directory: $COLAB_INSTALL_DIR" >&2
  exit 1
else
  if [ -n "$(git -C "$COLAB_INSTALL_DIR" status --porcelain)" ]; then
    echo 'The existing Colab checkout has changes; preserve them before rerunning.' >&2
    exit 1
  fi
  if [ "$(git -C "$COLAB_INSTALL_DIR" remote get-url origin)" != https://github.com/googlecolab/colab-mcp.git ]; then
    echo 'Existing checkout has a different origin; choose a new COLAB_INSTALL_DIR.' >&2
    exit 1
  fi
fi
git -C "$COLAB_INSTALL_DIR" fetch origin "$COLAB_MCP_REVISION"
git -C "$COLAB_INSTALL_DIR" checkout --detach "$COLAB_MCP_REVISION"
uv sync --python 3.13 --frozen --no-dev --project "$COLAB_INSTALL_DIR"
COLAB_EXECUTABLE="$COLAB_INSTALL_DIR/.venv/bin/colab-mcp"
COLAB_PYTHON="$COLAB_INSTALL_DIR/.venv/bin/python"
"$COLAB_EXECUTABLE" --help >/dev/null

# Preserve any existing server with this name instead of silently replacing it.
COLAB_EXISTING="$(mktemp)"
COLAB_SKILL_TMP="$(mktemp)"
trap 'rm -f "$COLAB_EXISTING" "$COLAB_SKILL_TMP"' EXIT
if "$COLAB_CODEX_BIN" mcp get "$COLAB_MCP_NAME" --json >"$COLAB_EXISTING" 2>/dev/null; then
  "$COLAB_PYTHON" -c '
import json, sys
config = json.load(open(sys.argv[1]))
transport = config.get("transport", {})
if transport.get("command") != sys.argv[2] or transport.get("args", []) or config.get("enabled") is False:
    raise SystemExit("An existing MCP configuration differs; preserve it and choose another server name manually.")
' "$COLAB_EXISTING" "$COLAB_EXECUTABLE"
else
  "$COLAB_CODEX_BIN" mcp add "$COLAB_MCP_NAME" -- "$COLAB_EXECUTABLE"
fi

cat >"$COLAB_SKILL_TMP" <<'SKILL'
---
name: predictive-chat-colab
description: Connect Google's local Colab MCP bridge and run the predictive workspace Laya notebook with measured GPU resource checks.
---

Use this skill when the user asks to connect Colab or work on the predictive-chat fine-tuning notebook. It is a project-specific workflow skill, not an upstream Google skill.

1. Work in a local Codex task on the same computer as the Colab browser. Google's bridge binds localhost. A bridge running in a cloud container cannot reach a browser on the user's Mac through that localhost address.
2. Check that the predictive-chat-colab MCP server exposes open_colab_browser_connection. Call that tool to open the official Colab connection page. Let the user sign in to the intended Google Workspace account and approve Colab's connection prompt. Never request passwords, export cookies, or copy Google tokens into chat.
3. Wait for the bridge to report success and refresh its tools after notifications/tools/list_changed. Merely opening a tab is not a successful connection. If tools do not refresh, reopen the local task/client and check the connection again.
4. Inspect the newly exposed notebook tools before using them. Open the existing predictive_workspace_colab.ipynb from ivankqw/predictive-chat-ui's codex/laya-finetune-preparation branch. Preserve the pinned package commit and frozen split hashes. Read finetune/README.md for the dataset policy and run steps.
5. Verify access by reading the notebook title/cells. A connected Google account is scoped here to the Colab browser workflow; it does not prove Drive/Gmail/Calendar API authorization.
6. Keep full training off until the user authorizes the run. Inspect the assigned GPU and run the notebook's one-step memory probe when authorized. Record actual peak memory and elapsed time. Start with batch 1 on one T4; consider a 24 GB L4 or 40 GB A100 only if measurements show the need. Never buy compute or publish checkpoints implicitly.
7. For an authorized full run, use separate train, calibration, validation and frozen test data. Report real results and errors; tiny random-checkpoint smoke tests are not model-quality evidence. Download artifacts before the runtime expires.

Source: https://github.com/googlecolab/colab-mcp/tree/b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1
SKILL
mkdir -p "$COLAB_SKILL_DIR"
if [ -e "$COLAB_SKILL_DIR/SKILL.md" ] && ! cmp -s "$COLAB_SKILL_TMP" "$COLAB_SKILL_DIR/SKILL.md"; then
  echo "An existing skill differs; leaving it unchanged: $COLAB_SKILL_DIR/SKILL.md" >&2
  exit 1
fi
cp "$COLAB_SKILL_TMP" "$COLAB_SKILL_DIR/SKILL.md"
printf 'Installed Colab MCP at %s\nInstalled skill at %s\n' "$COLAB_INSTALL_DIR" "$COLAB_SKILL_DIR"
echo 'Reopen a LOCAL Codex task on this computer and ask: Use $predictive-chat-colab to connect my Colab browser.'
echo 'Complete Google sign-in and the Colab connection prompt in the browser. Training remains off.'
