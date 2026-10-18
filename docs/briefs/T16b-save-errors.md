# T16b. Failed saves stay pending; the idle switch on the options page

Fixes audit A10 and A18 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Do this after T16a.

## 1. A10: a failed save is lost, and Test connection runs anyway

**Problem.** In `src/options/useSettings.ts`, `flush()` (lines 41-54) clears `pending` before the save and turns a rejected save into a resolved promise (it only sets the error status). So:

- the failed change is no longer pending, and nothing retries it;
- `TestSection` (`src/options/sections.tsx:73-81`) and `useTest()` (`src/popup/useTest.ts:26-35`) `await flush()` and then run the test, which reads the old saved settings.

**Fix.**

1. `flush()` returns `Promise<boolean>`: `true` when everything pending was saved, `false` when a save failed. Update `SettingsApi.flush` to match.
2. On failure, put the failed keys back into `pending` (a key the user changed again since is already there, which is fine). Keep the error status. Keep the queue going for later saves (the chain must not stay rejected).
3. The next `change()` or `flush()` retries the pending keys with the current values.
4. In `TestSection` and `useTest()`: when `await flush()` is `false`, do not send the test. Show `{ ok: false, message: 'Settings were not saved, so the test did not run. Try again.' }` as the result and stop the spinner.
5. Out of scope: closing the toolbar popup during the 400 ms typing delay. `pagehide` already calls `flush()`. Only change this if a test shows a lost edit.

**Tests.** `tests/e2e/options.spec.ts` stubs `chrome` in `openOptions()` with an in-page store (`window.__store`).

- Add a `failSets` number to `StubConfig`: the stub's `storage.local.set` rejects that many times, then works. Add a `window.__runtimeSent` array that records every `runtime.sendMessage` message, so a test can count `test-connection` messages.
- Test "a failed save blocks Test connection and is retried": open with `failSets: 1`, change the model, click Test connection, expect the save error, the "not saved" result, and no `test-connection` message. Click Test connection again: the model is now in `__store`, and one `test-connection` message was sent.
- Do the same for the toolbar popup if `tests/e2e/action-popup.spec.ts` has a matching stub; if it does not, say so in the report.

## 2. A18: the options page has no Fix while I type switch

**Problem.** The README says the options page has the same settings as the toolbar popup. `src/options/App.tsx:29-34` renders no idle switch, and `DefaultsSection` holds only Default mode. A user who opens only the options page cannot turn automatic sending off.

**Fix.**

- In `DefaultsSection` (`src/options/sections.tsx`), add a checkbox labelled **Fix while I type**, with the help text `Fixes a field after a 3 s pause. Off: the button and the shortcut still work.` It reads `settings.idleFix` and calls `change({ idleFix: !settings.idleFix })`, the same way `src/popup/QuickToggles.tsx:35-38` does.
- Use the existing `Field` control and the page's existing checkbox or input styles. No new design.

**Tests.** In `options.spec.ts`: the checkbox shows the stored value, and clicking it writes `idleFix: false` to `__store`.

## Done when

- A failed save stays visible as unsaved, and is saved by the next try.
- Test connection never runs against settings that failed to save.
- The options page can turn Fix while I type off and on.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Fixes group.
- One commit, message `T16b: <summary>`. Tick T16b in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A10 and A18. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
