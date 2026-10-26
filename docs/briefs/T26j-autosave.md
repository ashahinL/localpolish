# T26j. Document autosave: no lost drafts, honest "Saved"

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact without compat). The side panel has a document editor: `src/chat/DocumentView.tsx` (autosave in `createAutosave`) mounted by `src/chat/App.tsx` (view state `view.kind === 'document'`, `key={view.editor}`). A read-only review found two bugs. Fix only these two. No other behavior changes, no restyling.

Follow the `implement-plan` skill in its light form: build, test, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits. Keep the comment style of the surrounding code: few comments, only for a non-obvious why.

## Bug 1. Leaving the editor can lose the draft

Today, anything that leaves the document view (opening History or a chat, New chat, opening another document, + Doc) unmounts `DocumentView`. Its unmount effect calls `flush()` without waiting, and ignores a failure. Failing case: paste a body over 128 KiB (saves fail with "over the 128 KiB save limit"), then click New chat: the editor disappears, the save fails unseen, the draft is gone. A second case: a slow save is still running while the user reopens the same document, so the reopened text is the old body and a later edit can overwrite the newer one.

Required behavior:

1. Every navigation that leaves the document editor first awaits a flush of the current draft. If the flush fails (resolves `false`), the view stays on the editor (the red "Not saved: …" note is already shown there) and the navigation does not happen. If it succeeds, navigation proceeds.
2. Do it in `App.tsx` with one small helper, for example `leave(next: () => void)`: when `view.kind === 'document'` and the editor has registered its flush, `void flush().then(ok => ok && next())`, otherwise `next()`. Give `DocumentView` a way to register its `flush` with `App` (a ref prop such as `flushRef`, set once the autosave exists and cleared on unmount). Apply `leave` to every path in `App.tsx` that sets a different `view`, opens a document, starts a chat or opens a history entry while a document is open. Read the whole file and find them all (the `setView(...)` calls, `openDocument`, `newChat`, the `start` callback, the History callbacks). **Ask in chat** already flushes first; keep that.
3. Keep the existing `pagehide`, `visibilitychange` and unmount flushes as the fallback for the panel closing.
4. While a navigation waits for the flush, a second click must not start a second navigation (ignore it, or disable via a simple in-flight flag).

## Bug 2. "Saved" shows while there are unsaved edits

Today `createAutosave` emits `onNote({ kind: 'saved' })` when a save finishes, and nothing clears it when the user types again, so "Saved" stays for the whole 800 ms delay and an older in-flight save can show "Saved" while newer edits are still pending.

Required behavior: `change()` clears the note (`{ kind: 'none' }`) on every edit. `saveOnce` shows `saved` only when no newer edit is pending (`!dirty` and no timer set at that moment); otherwise it leaves the note alone. A failed save still shows the failure, even if newer edits are pending.

## Tests

- `tests/e2e/documents.spec.ts` has 8 tests and a helper setup. Add tests there:
  - a body over 128 KiB, then New chat (or History): the panel stays on the editor and shows "Not saved"; after the body is cut under the limit the note clears and navigation works.
  - editing a saved document: "Saved" is not shown right after typing, and shows after the autosave.
- Keep all existing tests unchanged and passing.
- Unit tests for `createAutosave` only if you export it cleanly; do not export it just for tests.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. The sandbox cannot bind port 5179 or start Chromium, so the orchestrator runs `npm run test:e2e`. Write the e2e tests carefully (`expect.poll` does not retry when its callback throws; use `?.`), and say in the report that they were not run. Do not edit `docs/plans/**`.

## Report

- Files changed and what changed in each; every place `leave` is applied.
- New tests, and whether they ran.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
