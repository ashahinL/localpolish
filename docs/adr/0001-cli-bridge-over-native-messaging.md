# ADR 0001: Use AI subscriptions through a CLI bridge over native messaging

Date: 2026-10-17
Status: accepted

## Context

The first draft used a local Ollama model. The owner does not want to run a local model. They want to use the AI subscriptions they already have (Claude, ChatGPT, SuperGrok). Those subscriptions have no API keys, so a browser extension cannot call them directly. Each one has a CLI that is logged in on this Mac: `claude`, `codex` and `grok`. All three run headless and return a short fix in about 4 to 7 seconds.

## Decision

The extension talks to a small Node script (`bridge/host.mjs`) through Chrome native messaging. The script runs the chosen CLI with the user text on stdin and streams the answer back.

We picked native messaging over a localhost HTTP server because:

- Chrome starts the script only for our extension ID. No open port, so other sites and apps cannot call it.
- No CORS setup and no auth token to manage.
- Nothing runs in the background when the extension is idle.

API-key providers (OpenAI-compatible and Anthropic) stay in the extension for anyone who has keys or runs a local server.

## Consequences

- One install step: `npm run bridge:install` writes the native host manifest. It must be re-run if the repo folder moves.
- Chrome starts native hosts with a minimal PATH, so the installer writes a wrapper script with the CLI folders on PATH.
- Each request starts a new CLI process. That costs a few seconds, which is acceptable for a rewrite.
- macOS only for now. Linux and Windows need different manifest locations.
- The CLIs are agents with tools. We turn tools off where the CLI allows it (`claude --tools ""`, `grok --tools ""`) and run Codex in a read-only sandbox, always in an empty temp folder.
