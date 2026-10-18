# T17a. Privacy, release guide and bench docs

Fixes audit A17 and A22 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Do this last among the fixes, after T15 and T16, so the docs describe the finished behavior. Docs only, plus one label in the UI.

Write in plain, short English, like the existing docs. No new sections that the code does not back up.

## 1. A17: `PRIVACY.md`

1. **Lines 21-23** say an answer is kept only while the rewrite popup is open. That is wrong: idle Fix keeps, per field, the last text it sent and its answer in the page's memory (`Slot` in `src/content/idle.ts:35-44`), outside the popup. Replace it with three plain facts:
   - LocalPolish writes no text or answer to disk.
   - While a tab is open, it keeps the last text it sent from each field and the answer in that tab's memory, so the marker and the popup can reuse them. Closing or reloading the tab clears them.
   - What each CLI keeps is under "What it sends, and where" (Claude Code: no session saved; Codex: ephemeral; Grok: history in `~/.grok`).
2. **Lines 64-65** say keys are never sent anywhere. Each API key does go to its own provider to sign in. Say: "It sends each API key only to the provider it belongs to: the OpenAI-compatible key to the base URL you set, the Anthropic key to Anthropic's API. It never sends your settings or site list anywhere."
3. **Lines 48-51,** the Fix while I type exclusions. Check each against the code after T15 and T16, and add what is now true: editors inside frames on a listed site are skipped (T15a), and so are fields inside an area that turns spellcheck off (T15d). Say the switch is in the toolbar popup and the options page (T16b).
4. Keep the Grok exception (keeps history in `~/.grok`, can still search X) next to every "tools off" claim, here and in `README.md`.

## 2. The Sites wording

The site list now stops the button and Fix while I type, not just the button. Update:

- the options label at `src/options/sections.tsx:141`, "Hide the button on these sites", to "Hide LocalPolish on these sites";
- the README sentence "To hide the button on a site…" in the Using it section;
- any toolbar popup Sites tab text that says only "button" (`grep -rn "button" src/popup/SitesTab.tsx`).
- Update an e2e test only if it matches the old label text.

## 3. A22: `RELEASING.md`

1. **Step 6 (lines 67-71)** pushes without `git pull --rebase`, and tags before any rebase. Change the order to:
   1. commit;
   2. `git pull --rebase`; stop if it conflicts;
   3. if the rebase brought in new commits, run the gates from step 1 again;
   4. tag;
   5. `git push origin main vX.Y.Z`.
2. **"If the bridge changed" (lines 85-90)** is wrong. The installed wrapper runs `bridge/host.mjs` straight from the clone (`bridge/install.mjs:48-65`). So:
   - a change to `bridge/host.mjs` or `bridge/lib.mjs` reaches people with `git pull` alone, from the next rewrite;
   - `npm run bridge:install` is needed again only when the wrapper or the Chrome manifest changes (`bridge/install.mjs`), or when the repo folder moves.
   Say this in the release notes when it applies.
3. **"The number" (lines 31-37).** Make the major rule exact: major only when everyone must redo setup. A reinstall that only some people need (for example T15e, only for repo paths with `$`, a backtick or `"`) is a minor, with a line in the notes saying who must reinstall.
4. Add a short step after the release: delete merged branches with `git branch -d <branch>` and `git push origin --delete <branch>`, only branches Git lists as merged, never `main`, `master`, `dev`, `develop`, `prod`, `production` or `release*`.

## 4. Old bench results

`bench/README.md` and `docs/benchmarks/2026-10-17-fix-mode.md` mix old results with current choices. Add one line at the top of each:

> Results from 17 October 2026. The bridge and the default have changed since. Today the default is Codex `gpt-6-luna` at effort `none` (`src/core/settings.ts`), and the Fix prompt is in `src/core/prompts.ts`.

Do not rerun any benchmark. Do not change the numbers.

## 5. Changelog

Under `## Unreleased` in `CHANGELOG.md`, add the lines for this task in its groups (Safer, Fixes, For contributors).

## Done when

- Every privacy claim matches the code, or says plainly what is not covered.
- The release guide rebases before tagging, and describes bridge updates correctly.
- `npx prettier --check .` passes, and the e2e tests pass after the label change.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`.
- One commit, message `T17a: <summary>`. Tick T17a in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What changed, per file. Any claim you could not match to code, and what you wrote instead.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
