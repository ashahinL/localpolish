# Reuse Fix requests after harmless ending additions

Status: implemented; remaining live checks pending.

The user approved these rules on 2026-10-21:

- A whole-field badge or Fix shortcut reuses an unchanged request or saved answer.
- Appended spaces and one final period also reuse it. Changes inside the text,
  removed text, newlines, other punctuation, and multiple added periods do not.
- Reused answers preserve the appended ending on Accept and Copy. Avoid a double
  period when the answer already ends with one.
- A whole-field click after other edits cancels the old request and sends the
  latest complete text immediately. Late replies from canceled requests are ignored.
- A partial selection always starts its own request for the selected text.
- Closing a whole-field Fix popup keeps its request running for the badge.
  Clicking back into the editor still closes the popup. Further typing uses the
  normal idle timer. No editor locking or automatic restart while the popup is open.

This extends the existing request sharing in the content script. ADR 0001 and
the provider protocol do not change. Selected-text and other-mode requests
remain separate from the whole-field idle Fix cache.

- [x] Implement and verify this behavior as one task, review the diff, build,
      and commit it. Run focused regressions before and after the changes, then
      lint, typecheck, unit tests, formatting, and editor/popup browser checks.

Live Discord checks should use an unsent draft only.

Verification passed: 97 editor and popup tests in installed Brave, 536 unit tests
with 9 skipped, lint, typecheck, formatting, and production build. Live Discord
checks covered badge reuse after appended spaces and a period, cancellation
after typing and clipboard paste, closing a running popup, a separate selected
phrase, and cached answers with no changes needed. Remaining live checks include
the sparkle button and additional punctuation and newline cases.

## Empty draft regression

The user found that clearing a draft left a dimmed badge, both during and after
a request. Clearing a field must cancel its request, discard the saved answer
and draft, and remove the badge. Late replies must stay ignored. Empty or
whitespace-only fields must send nothing; automatic checks still require four
words. Explicit fixes of short selections remain allowed.

- [x] Reproduce the clearing bug in textarea and Slate browser tests, fix the
      draft cleanup, run the full editor/popup suite and code checks, and build.

- [ ] Verify the rebuilt extension in Discord after it is reloaded.

Clearing regressions reproduced before the fix and pass after it in textarea
and Slate. They cover active and completed requests, late replies, spaces-only
input, fewer than four words, and retyping the same draft after clearing.
Verification passed: 70 popup tests, 31 editor tests in installed Brave, 536 unit
tests with 9 skipped, lint, typecheck, formatting, diff checks, and production
build. Code and test guard reviews found no further issues. Comment review found
no changed comments to flag and no reusable skill to extract. The live Discord
check of this new build remains pending. The user requested committing and
pushing both changes before that check.
