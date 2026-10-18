# T18a. Final-text view in the rewrite popup

Proposed feature F02 ([audit](../audits/1.0.0.md)). Lane: art (Claude Opus), because it is UI work. Do this after T15c.

## Why

The rewrite popup shows only a word diff (`Body` in `src/content/ui/Popup.tsx`): deleted words in `<del>`, added words in `<ins>`. When Accept fails and copying fails too, the popup tells the user to "Select the new text in this popup and copy it" (`src/content/popupState.ts:163`). But selecting the diff also picks up the deleted words. The user has no clean text to copy.

## What to build

1. A small two-option switch above the body, **Changes | Final**, shown only when the answer is done and changed (`phase === 'done'` and not `isUnchanged(state)`).
   - **Changes** is today's diff, and stays the default.
   - **Final** shows `state.result` as plain text in the existing `.lp-text` style: selectable, `white-space: pre-wrap`, no `<ins>` or `<del>`.
2. Keep the choice for the life of the popup. A new answer (a new tab or chip) keeps the current view.
3. When the popup shows the "Copying failed too" note, switch to **Final** by itself, so "select the new text" works. Update that note's text if needed so it matches what is on screen.
4. Accept and Copy still use exactly `state.result` in both views. No editing before Accept, and no accepting single changes. Those are out of scope.
5. Match the popup's look in light and dark mode. Keep the narrow layout working (the popup sits next to the field and can be small). Use buttons with `aria-pressed`, like the tabs, so it works by keyboard and screen reader.

## Tests

- `src/content/popupState.test.ts` if the view lives in the state; otherwise none.
- `tests/e2e/popup.spec.ts`, using the fixture harness (`openPopup` with a `SUCCESS` script):
  - "Final shows only the new text": click Final, expect the body text to equal the rewrite and no `del` element.
  - "the view stays when the answer changes": pick Final, run Shorter, expect Final still pressed.
  - "a failed accept and copy switches to Final": follow the existing accept-failed tests (search for `Copying failed too`), expect Final pressed and the plain text shown.
- Take one screenshot of the popup in each view in light and dark mode, and look at it before you report.

## Done when

- After a failed accept and copy, the user can select and copy only the new text.
- Changes stays the default, and Accept and Copy are unchanged.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line under `## Unreleased` in `CHANGELOG.md`, in the New group. Mention the Final view in the README's Using it section.
- One commit, message `T18a: <summary>`. Tick T18a in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What changed. Files touched. Gate results. The screenshots you checked.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
