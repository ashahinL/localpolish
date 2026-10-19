# T20. Safe Accept fallback after page paste handlers

Lane: Sol high. Follow `implement-plan` in its light form: build, test, keep the plan current, report. Skip guard skills and the final review pass. The owner reviews the diff.

## Problem

Commit `73844d4` changed every rich editor to paste first. In `src/content/editable.ts`, `paste()` checks the selection before dispatching the event. If no listener prevents the event, `applyRich()` falls back to `insertText`.

A page paste listener can move selection or edit the selected text without preventing the event. The fallback then overwrites another editor or the new text. This breaks T15c's existing safety requirement.

## Work

1. In `tests/e2e/editable.spec.ts`, add two regressions on the plain `#ce` editor. A one-time paste listener must move selection into `#other` in one test and replace the selected text in the other. Neither listener prevents the event.
2. Assert that Accept returns `changed`, the other editor stays unchanged, and the original editor keeps its original text or the page's new text.
3. Run those tests before the fix to prove the overwrite.
4. Immediately before fallback `insertText`, check that both selection endpoints remain inside the original root and the selected text still matches the captured text. Reuse the existing normalized comparison. Preserve line breaks, paste-first behavior, waits, and Undo.
5. Run all editor tests. Update the plan and changelog.

## Checks

- Targeted: `npx playwright test tests/e2e/editable.spec.ts`.
- Full gates: lint, typecheck, unit tests, Prettier, build, and all browser tests.
- After push, verify full CI and dispatch `platforms.yml` at the final implementation commit.

No new dependencies, version changes, real providers, rewrite CLIs, bridge installs, or real drafts. The implementer leaves changes uncommitted. The orchestrator verifies and commits this task separately.

## Report

Report the failing-before and passing-after results, changed files, and remaining checks.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
