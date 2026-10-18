# T18b. First-run setup

Proposed feature F01 ([audit](../audits/1.0.0.md)). Lane: art (Claude Opus), because it is UI work. Do this after T16b.

**Owner's decision (18 October 2026):** Fix while I type stays **on** by default for new installs, as decided in T14a. Setup shows the switch already on, says what it does, and lets the user turn it off. Do not change the default.

## Why

Today a new user lands on nothing. They must find the toolbar popup or the options page, pick a provider, and know that Fix while I type is on by default. With the default Codex provider and no bridge yet, idle Fix tries to run after every pause and fails, so nothing leaves the browser, but the user sees error markers and no way forward.

## What to build

1. In `src/entrypoints/background.ts`, on `chrome.runtime.onInstalled` with `reason === 'install'` only, open a setup page in a new tab. Do nothing on `update`.
2. A new extension page, `setup.html` (a WXT entrypoint next to the options page), with three short steps on one page:
   1. **Pick a provider.** Reuse the toolbar popup's provider picker and forms (`src/popup/ProviderPicker.tsx`, `src/popup/ProviderTab.tsx`) and the bridge card, so the CLI install and login hints come for free.
   2. **Test it.** Reuse `src/popup/TestConnection.tsx`. It sends the fixed sample, never user text.
   3. **Fix while I type.** The same switch as the toolbar popup, shown on. Say in one line where the text goes for the chosen provider: this computer (bridge to a CLI, which sends it to Anthropic, OpenAI or xAI), the base URL (and whether it is local), or Anthropic's API. For Grok, add that it keeps history in `~/.grok` and can search X.
   A **Done** button closes the tab.
3. Step 3 shows the switch on, as stored. Turning it off saves `idleFix: false` with `saveSettings` from `src/core/settings.ts`, like the toolbar popup does.
4. **No error markers before setup.** On a fresh install the bridge is usually not installed yet, so every idle request fails with the "bridge is not installed" error, and idle Fix would put a red `!` marker on every message box after each pause. In `src/content/idle.ts` `record()`, when an idle request fails with that error (`src/background/providers/cli.ts:14`), drop the result and show no marker. The button, the shortcut and the rewrite popup still show the error. Prefer an error code over matching the message text if that is simple.
5. Match the look of the toolbar popup (`src/popup/popup.css`, `docs/design/popup/`), light and dark.

## Tests

- e2e with the real extension (`tests/e2e/extension.spec.ts` launches it with a fresh profile, so `onInstalled` fires with `install`): the setup tab opens; the switch shows on; turning it off means a pause sends nothing (use the mock server's `requests`). Add a fixture-harness test in `tests/e2e/popup.spec.ts` where the idle request fails with the bridge-not-installed error: no `.lp-mark` appears.
- An `update` does not open the page. If you cannot trigger an update in Playwright, test the `onInstalled` handler as a unit and say so.
- Screenshots of the page in light and dark mode, checked before you report.

## Done when

- A fresh profile reaches a working Test connection without reading the README.
- Before the bridge is installed, typing in a message box shows no error markers.
- Existing users see nothing new on update.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line under `## Unreleased` in `CHANGELOG.md`, in the New group. Describe the setup page in the README's Setup section.
- One commit, message `T18b: <summary>`. Tick T18b in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What changed. Files touched. Gate results. The screenshots you checked.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
