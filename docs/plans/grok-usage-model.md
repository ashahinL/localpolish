# Grok usage model

Status: Complete. U01 is implemented, reviewed, and verified. This plan is included in the task's commit.

## U01: Preserve the model reported by Grok

- [x] Forward Grok's `system/init.model` through the native bridge.
- [x] Move the current attempt from the empty-model usage row to the reported model, once per request.
- [x] Preserve total counts, failed and cancelled attempts, concurrent requests, and old unknown history.
- [x] Test the native protocol, provider callback, and stored usage. Check the built usage page with a fake native response.
  - Unit tests cover the real native host with a private fake CLI, provider callback, and stored usage.
  - `tests/e2e/grok-usage.spec.ts` loads a private copy of the built extension with a fake native port. Starting with the screenshot's 38 requests, two Test connection clicks show `grok-4.7` with 2 requests and a total of 40. Reload preserves the model row. The old nine unknown requests remain unchanged.
- [x] Run lint, typecheck, unit tests, formatting, and build. Review and commit this task separately.
  - Reviewer checks passed on 2026-10-20: lint, typecheck, unit tests (516 passed, 2 skipped), Prettier, build, and the full browser suite (178 passed).
  - Production, tests, documentation, and comments reviewed. Removed a constant-only test and redundant local aliases and saturation logic. Comment Sicko is unavailable in this toolset, so its agent pass was skipped.

Blank rows stay stored with an empty model. The usage table now labels that row Unknown (CLI default). Old counts were not renamed or cleared.

A move onto a row that is already at the safe integer cap is skipped, so the total does not drop. Below the cap, the target grows by one, same as a new attempt.

The installed Grok CLI documentation describes the model field in `~/.grok/docs/user-guide/14-headless-mode.md`, under `streaming-messages-json`. Do not hard-code Grok 4.7 or relabel old history using today's default. No live model calls are needed.

## Handoff

- Previous commit: `18bbdf8`. This task's commit contains the implementation, tests, and this plan.
- No tasks remain. No live provider calls were made. No reusable skill was proposed or needed.
- The local `dist` build contains the fix. Reload the unpacked extension in Chrome to use it. This task does not publish a release or replace the previous release ZIP.
- No delegate or browser process remains active.
