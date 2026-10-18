# T18c. Keep API keys out of content scripts

Proposed hardening F03 ([audit](../audits/1.0.0.md)). Lane: Sol high. Do this after T15a, T15b and T16a.

## Why

The content script runs in every page and frame. It calls `loadSettings()` (`src/entrypoints/content.ts:47-60`), which reads the whole `settings` record from `chrome.storage.local`, API keys included, and it listens to `chrome.storage.onChanged`, which also delivers the whole new record. Page scripts cannot read the content script's isolated world, and no exploit is known. But a key has no reason to be in a web page's process at all. This is hardening, not a bug fix.

## What to build

1. **Find out first.** Check, in a real Chromium with the built extension, whether `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` is supported and whether a content script then gets an error from `chrome.storage.local.get` and no `storage.onChanged` events. Write what you found in the report. If it is not supported for `local`, stop and report before building anything else.
2. **Background.** Call `setAccessLevel` with `TRUSTED_CONTEXTS` at the top level of `defineBackground` (it runs at every service worker start).
3. **Page settings by message.** Add a runtime message `{ type: 'page-settings' }` to `src/core/messages.ts`. The background answers with only what the content script uses: `{ blocklist, idleFix, defaultMode }`. Use the sender's frame and tab only if T15a's check needs them.
4. **Change notices.** In the background, on `chrome.storage.onChanged` for `settings`, send `{ type: 'page-settings-changed' }` to every tab with `chrome.tabs.sendMessage` (catch the error for tabs with no content script). The content script then asks for `page-settings` again and runs the T15b refresh.
5. **Content script.** Replace `loadSettings()` and the `storage.onChanged` listener in `content.ts` with the message flow. `getSettings` for the controller (`content.ts:74`) needs only `defaultMode`; narrow its type if that is simple, or fill the rest from `DEFAULT_SETTINGS` without keys.
6. The toolbar popup, the options page and the background still use `loadSettings()` and `saveSettings()` as today. They are trusted contexts.

## Tests

- e2e with the real extension (`tests/e2e/extension.spec.ts`): store settings with a fake `openaiApiKey`, then in a page with the content script check that the content world cannot read storage. Playwright cannot run code in the isolated world directly; if you cannot reach it, assert instead that the stored key never appears in any message the content script receives, and say how you checked.
- The existing blocklist, idle Fix, shortcut and API rewrite tests must still pass. An API rewrite must still authenticate (the mock server sees the bearer key).
- Changing the blocklist or idle switch in the toolbar popup still updates an open tab (T15b's tests).

## Done when

- A content script can no longer read API keys from storage.
- Site and idle settings still reach every tab and update live.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line under `## Unreleased` in `CHANGELOG.md`, in the Safer group. Update `PRIVACY.md` if it describes where keys are read.
- One commit, message `T18c: <summary>`. Tick T18c in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What you found in step 1. What changed. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
