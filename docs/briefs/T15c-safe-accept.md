# T15c. Safe Accept in rich editors

Fixes audit A04 and A05 ([audit](../audits/1.0.0.md)). Lane: Sol high (timing-sensitive DOM code).

## Problem

All code is in `src/content/editable.ts`.

1. **A04. Paste can land in another editor.** `applyRich()` (line 201) selects the target range, checks it (line 216), then on the Lexical and Draft.js path waits 50 ms (`waitForRender()`, line 225) and calls `paste()`. `paste()` (line 240) dispatches the paste event on the live `selection.anchorNode` without checking that the selection is still inside `root`. If the page moves focus and selection to editor B during that wait, B receives the rewrite meant for A. The same gap exists on the fallback path at lines 235-237.
2. **A05. Line breaks are ignored in the stale check.** `normalize()` (line 282) turns every whitespace run, newlines included, into one space. So if the user changes where a paragraph splits between opening the popup and pressing Accept, the check at line 216 still passes, and Accept overwrites that edit. `replaced()` and `showsText()` (lines 269-280) have the same blind spot for the success check.

## Steps

1. **A04.** At the start of `paste()`, before building the `DataTransfer`:
   - Return `{ ok: false, reason: 'changed' }` unless `root.contains(selection.anchorNode)` and `root.contains(selection.focusNode)`.
   - Return `{ ok: false, reason: 'changed' }` unless the selected text still matches: compare `selection.toString()` with `original` using the new `normalize()` from step 2.
   - Only then dispatch the paste event. Never write first and check afterwards.
2. **A05.** Change `normalize()` so it keeps where lines break but not how many blank lines there are, because editors report blank lines differently (`readRich()` at line 145 already maps `\n\n` to `\n` for paragraph editors):
   - a non-breaking space (`\u00a0`) becomes a space; `\r\n` and `\r` become `\n`;
   - any whitespace run that contains a `\n` becomes one `\n`;
   - any other whitespace run becomes one space;
   - trim the ends.
   Use it everywhere `normalize()` is used today (lines 216, 219, 270, 278).
3. If an existing paragraph-editor, Lexical, Draft.js or Undo test fails after step 2, do not loosen the rule back to spaces. Find which side reports the break differently, fix that side (for example by reading both sides through `readRich()`), and say so in the report.

## Tests

All in `tests/e2e/editable.spec.ts`. It already exposes `window.__lp.captureTarget` and `window.__lp.applyReplacement` and has the helpers `captureText` and `apply`. Model the new tests on "apply reports changed when the field text moved" (line 123).

- **A04, Lexical:** type into `#lexical`, select all, capture the target. Add a second contenteditable `#other` to `tests/e2e/fixtures/index.html` with a `paste` listener that inserts the pasted text (as the audit's probe did). Start `applyReplacement` in the page without awaiting it, and in a `setTimeout(…, 0)` move focus and a selection into `#other`. Await the result. Expect `{ ok: false, reason: 'changed' }`, `#other` keeps its literal original text, and `#lexical` keeps its text.
- **A04, Draft.js:** the same with `#draft` as editor A.
- **A04, the original editor changes during the wait:** for `#lexical`, change its text in the `setTimeout` instead of moving focus. Expect `changed` and the new text kept.
- **A05:** in the plain contenteditable `#ce`, write two paragraphs `hello world` and `line two`, capture the whole field, then change the DOM to `hello` and `world line two`. Expect `apply` to return `changed` and the DOM to keep the new split.
- **A05, success check:** a rewrite that only changes a line break must not report success if the editor ignored it. Add one case if the fixture can show it; if it cannot, say so in the report.
- All existing tests in `editable.spec.ts` must still pass, especially Lexical line breaks (line 104), the paragraph editor tests (lines 182, 199), `<pre>` (line 228) and Undo.

## Done when

- A paste never reaches an editor other than the captured one.
- A change in paragraph splits is reported as `changed`, not overwritten.
- Normal Accept and Undo still work in textarea, contenteditable, Draft.js and Lexical.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Fixes group.
- One commit, message `T15c: <summary>`. Tick T15c in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A04 and A05. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
