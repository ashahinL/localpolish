# T26j. Pre-release review of 1.5.0 (read-only)

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 adds a new look, documents in the side panel, a rebuilt toolbar popup and a restyled options page. This is a **read-only review** of everything since `v1.4.0`. Do not edit, create or delete any file. Do not run `git commit`.

Plan: `docs/plans/redesign-1.5.md` (goal, decisions, risks). Design: `docs/design/redesign/notes.md`.

Follow the `implement-plan` skill in its light form. Skip the guard skills.

## What to review

`git diff v1.4.0..HEAD -- src scripts wxt.config.ts` (65 files overall, about 4400 added lines; tests are in `tests/`). Start with the new and risky parts:

1. `src/core/documents.ts` (storage, lock, size limit, bad data).
2. `src/chat/DocumentView.tsx`, `src/chat/documentFix.ts`, `src/chat/App.tsx` and the other `src/chat/**` files that changed (autosave, loading, delete, Insert, unsaved state, Arabic text with `dir="auto"`).
3. `src/content/fix.ts` (Fix wiring moved out of `src/entrypoints/content.ts`), `src/content/position.ts`, `src/content/controller.ts`, `src/content/ui/root.ts`, `src/content/ui/Popup.tsx`, `src/content/chatInsert.ts`.
4. `src/entrypoints/background.ts` and `src/background/**`: the `polish` command handler, the `open-popup` message, the blocklist skip for the extension's own side panel (`isPanelSender`), `chat-open-plain` with `kind: 'document'`. Check sender checks: only the extension's own pages may send these.
5. `src/popup/**` and `src/options/**`: behavior must be unchanged except what the plan says. Look for lost labels, `aria-*`, roles, or a setting that can no longer be edited.
6. `src/core/when.ts` (Cairo time zone, day boundaries).

## What to look for

- Correctness bugs, with a concrete failing input or state for each. Say how you know.
- Regressions on web pages: nothing in `src/content/**` may change how Fix behaves on a site (the compact mode must apply only in the side panel).
- Security: message senders, anything from page text reaching the extension unchecked, anything that could send, post or submit on a site.
- Data loss: document autosave races, delete, an emptied document, a failed save shown as saved.
- Dead code, unused exports, leftovers from the old popup layout (for example `QuickToggles` above the tabs, the old Open chat button, `about` ids, the `About` tab).
- Comments that restate the code, mark history ("added in T26f", "moved from"), or describe a workaround. List file and line. Do not rewrite them.

Do not report style preferences, missing tests for trivial code, or anything you cannot tie to a file and line. Fewer, sure findings are better than many.

## How to check

Read the diff and the code. You may run `npm run lint`, `npm run typecheck` and `npm test`. Do not run `npm run build`, `npm run test:e2e` or any server (the sandbox cannot bind ports). Do not touch `dist/`.

## Report

- Findings, most severe first: file:line, what is wrong, the concrete failing case, and a one-line fix idea. Mark each **bug**, **risk** or **cleanup**.
- A separate list: comments to delete or shorten (file:line, one line why).
- Things you checked and found fine, in one line each.
- Gate results with exact commands and counts.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
