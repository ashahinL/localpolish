# Keep Discord editable after Accept

Status: local checks and live Discord test passed.

The paste-first path can fall back to `execCommand('insertText')` when Slate
ignores a synthetic paste. That changes the DOM without updating Slate's text
model. The existing Copy fallback handles rejected replacements.

This does not change ADR 0001 or the provider flow.

- [x] Reproduce the ignored-paste path with a real Slate editor. Verify that
      Accept preserves the original draft and typing and Backspace still work.
- [x] Prevent direct DOM insertion into Slate when paste is unhandled. Keep
      ordinary contenteditable replacement working.
- [x] Run editor and popup browser tests, lint, typecheck, unit tests, and build.
      Review the diff and commit this fix as one task.

Verification: the regression failed before the fix, reporting successful Accept
while Slate's model kept the old text and later editing failed. After the fix,
all 83 editor and popup tests passed in installed Brave, including normal Slate
Accept and the ignored-paste test with typing and Backspace. Lint, typecheck,
formatting, 509 unit tests, and the production build passed. Nine unit tests
were skipped by the existing suite. The comment review found no new comments
or suppressions and no reusable skill to extract.

Live check on 2026-10-21 in the user's Brave profile: opened the existing test
draft in a group with only the user's account. Accepted the idle correction
from `i has went home` to `I went home`. Backspace changed it to `I went hom`;
typing `e` restored `I went home`. Ctrl+Z undid that typed character. Restored
the `e` and left the corrected draft unsent. The existing draft in the other
chat was untouched. This confirms the normal Accept path in live Discord;
ignored paste is covered by the local regression test.

Desktop control initially failed to connect, then stopped on a browser URL
check after reconnecting. It worked on the final retry. No local app settings
or runtime files were changed.
