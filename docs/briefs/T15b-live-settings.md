# T15b. Settings changes reach existing idle work

Fixes audit A02 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Do this after T15a, which changes the `isEnabled` checks in `src/entrypoints/content.ts`.

## Problem

When the user blocks the site or turns Fix while I type off, the content script reloads its settings (`content.ts:47-60`), but nothing already on screen reacts:

- Idle markers stay visible. `renderMarks()` in `src/content/idle.ts:286` never checks `deps.isEnabled()`.
- Clicking an old marker runs `activate()` (`idle.ts:228-249`), which can call `send()` with no eligibility check. The audit saw one new request after the site was blocked.
- An idle request already in flight keeps running and then shows its marker.
- The floating button (`src/content/button.ts`) stays visible until the next selection change.

## Steps

1. **`idle.ts`.**
   - At the top of `renderMarks()`, when `!deps.isEnabled()`: for every element in `marked`, cancel its in-flight request with `cancel(slot)` unless the popup is waiting on it (the popup owns that request; see `waitOn`), clear its timer, set `slot.result = undefined`, then `marked.clear()` and `hideAll()`. Return.
   - At the top of `activate()`, when `!deps.isEnabled()`, call `renderMarks()` and return. A click on a stale marker must never send.
   - Add `refresh(): void` to the `IdleFix` interface and the returned object. It calls `renderMarks()`. Pending timers need no change: `tryRun()` already checks `deps.isEnabled()` when the timer fires.
2. **`button.ts`.** Make `createButton` return `{ refresh(): void }`, which calls the existing `update()`. `update()` already hides the button when `wanted()` returns null.
3. **`content.ts`.** In `refresh()` (line 47), after `settings = loaded`, call `idle.refresh()` and `button.refresh()`. `idle` and the button are created after `refresh` is defined, so keep a reference that is safe to call before they exist.
4. The shortcut and the rewrite popup must keep working on a blocked site. Do not close an open rewrite popup.

## Tests

- **Fixture harness:** `tests/e2e/fixtures/main.js` passes `isEnabled: () => true` to `createIdleFix` (line 94) and `createButton` (line 83). Change both to read a flag, and add `setEnabled(on)` to `window.__lp` that sets the flag and calls the `refresh()` of both. Add `setEnabled` to the `PageApi` type in `tests/e2e/popup.spec.ts`.
- **`popup.spec.ts`, inside `test.describe('idle fix', ...)` (line 344),** using its `startIdle`, `pause` and `requests` helpers:
  - "turning idle off hides the marker and its click sends nothing": get a fix marker, call `setEnabled(false)`, expect `.lp-mark` count 0. Turn it back on (`setEnabled(true)`), type more, pause, and expect a new marker.
  - "turning idle off during a request drops its answer": start a request, call `setEnabled(false)` before `FAKE_REPLY_MS` passes, finish the clock, expect no marker and no extra request.
  - "a stale marker click on a disabled page sends nothing": give `setEnabled` a second argument, `setEnabled(on, refresh = true)`, so a test can flip the flag without the refresh. Get a marker, change the text, call `setEnabled(false, false)`, click the marker, and expect `requests()` unchanged and the marker gone.
- **`tests/e2e/extension.spec.ts`, inside `test.describe('idle Fix', ...)` (line 263), real extension:** get a marker as in the first test there, then call `writeSettings(sw, url, { blocklist: ['localhost'] })`, expect `.lp-mark` count 0 (poll), type more words, wait 4.5 s, expect `mock.requests` still length 1.

## Done when

- Blocking the site or turning idle Fix off removes markers and the button at once, and no automatic or marker request goes out afterwards.
- Turning it back on works without a reload.
- The shortcut and an open rewrite popup are unaffected.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Safer group.
- One commit, message `T15b: <summary>`. Tick T15b in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A02. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
