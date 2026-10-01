# Connect Colab to Codex

Google publishes a Colab MCP bridge at https://github.com/googlecolab/colab-mcp. The bridge opens a Colab connection page and uses the browser's signed-in Google account. A separate Workspace-wide OAuth client is not needed to work with Colab notebooks.

The upstream README requires “the client to be running locally on your device.” The server opens a WebSocket on `localhost` with a per-session token and accepts Colab origins. Therefore install it on the Mac running your browser and local Codex task. Installing it in this cloud container does not connect your Mac's browser.

## Install locally

From a local checkout containing this file:

```bash
bash finetune/integrations/install-colab-mcp.sh
```

This installs upstream commit `b9ab3899e0f1fa493390b1fd6d54aa2e464ecdf1` with its frozen dependency lock and Python 3.13, adds the `predictive-chat-colab` MCP entry through `codex mcp add`, and installs a project-specific workflow skill under `~/.agents/skills/predictive-chat-colab`. Existing conflicting configuration or skill files are preserved. Missing `uv` can be installed through Homebrew on macOS. The fine-tuning package still uses its own Python 3.12 environment.

Reopen a **local** Codex task and ask:

> Use $predictive-chat-colab to connect my Colab browser and open the predictive workspace notebook. Keep full training off.

Codex should call `open_colab_browser_connection`. Sign in to your intended Google Workspace account in the opened Google page and complete the connection prompt. The bridge then exposes the notebook tools dynamically. Successful notebook readback establishes access; an open tab or installed package does not.

If tools do not appear after connection, check whether your Codex client refreshes tools on `notifications/tools/list_changed`, then reopen the task/client. Google's README lists Gemini CLI, Claude Code, and Windsurf as known compatible clients; Codex registration is prepared here, but an end-to-end Codex/Colab browser session has not been verified.

This authorizes the Colab browser workflow, not Gmail/Calendar or general Drive API access. The separate `googleworkspace/cli` project requires a Google Cloud OAuth client for those APIs and is not needed for this notebook connection.

## Validation performed in cloud

- Installed `colab-mcp==1.0.1` from the pinned upstream source with `uv sync --frozen --no-dev`.
- Completed a real stdio MCP initialize/list-tools exchange: server `ColabMCP`, protocol `2025-11-25`, tool `open_colab_browser_connection` exposed.
- Shell syntax and installer help checked. The macOS installer and a signed-in browser connection have not been executed here.
- Google authentication, GPU allocation, and fine-tuning remain pending. This cloud task has no executable access to your Mac or its signed-in browser.
