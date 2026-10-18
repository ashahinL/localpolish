# T18b. First-run setup

Proposed feature F01 ([audit](../audits/1.0.0.md)). Lane: art (Claude Opus), because it is UI work. Do this after T16b.

**Owner decision needed before dispatch:** should a new install start with Fix while I type **off** until the user makes a choice in setup? Recommended: yes, so no text leaves the browser before the user has picked a provider and said yes to automatic sending. Existing users keep their saved choice either way. Write the answer here before you start:

> Owner's answer: _not decided yet_

## Why

Today a new user lands on nothing. They must find the toolbar popup or the options page, pick a provider, and know that Fix while I type is on by default. With the default Codex provider, idle Fix sends text as soon as the user pauses in any message box, even before they have set anything up.

## What to build

1. In `src/entrypoints/background.ts`, on `chrome.runtime.onInstalled` with `reason === 'install'` only, open a setup page in a new tab. Do nothing on `update`.
2. A new extension page, `setup.html` (a WXT entrypoint next to the options page), with three short steps on one page:
   1. **Pick a provider.** Reuse the toolbar popup's provider picker and forms (`src/popup/ProviderPicker.tsx`, `src/popup/ProviderTab.tsx`) and the bridge card, so the CLI install and login hints come for free.
   2. **Test it.** Reuse `src/popup/TestConnection.tsx`. It sends the fixed sample, never user text.
   3. **Fix while I type.** Two clear buttons: "Yes, fix after I pause" and "No, only when I ask". Say in one line where the text goes for the chosen provider: this computer (bridge to a CLI, which sends it to Anthropic, OpenAI or xAI), the base URL (and whether it is local), or Anthropic's API. For Grok, add that it keeps history in `~/.grok` and can search X.
   A **Done** button closes the tab.
3. If the owner said yes above: `onInstalled` with `reason === 'install'` saves `idleFix: false` before opening the page, and step 3 saves the user's pick. Use `saveSettings` from `src/core/settings.ts`.
4. Match the look of the toolbar popup (`src/popup/popup.css`, `docs/design/popup/`), light and dark.

## Tests

- e2e with the real extension (`tests/e2e/extension.spec.ts` launches it with a fresh profile, so `onInstalled` fires with `install`): the setup tab opens; nothing is sent from a typed message box before the choice is saved (use the mock server's `requests`); after "Yes", idle Fix works; after "No", a pause sends nothing.
- An `update` does not open the page. If you cannot trigger an update in Playwright, test the `onInstalled` handler as a unit and say so.
- Screenshots of the page in light and dark mode, checked before you report.

## Done when

- A fresh profile reaches a working Test connection without reading the README.
- No automatic request happens before the user's choice (if the owner said yes).
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
