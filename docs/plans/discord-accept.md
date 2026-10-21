# Keep Discord editable after Accept

Status: local fix verified; live Discord test blocked by desktop control.

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

Live Discord in the user's Brave profile still needs testing. The computer-use
tool cannot connect to its Windows named pipe. Retrying `sky.list_apps()` and
resetting the Node runtime did not restore it. The app logs resolve runtime
files, but no computer-use pipe is present. Restart the desktop app, reopen this
chat, and retry desktop control before testing the built extension on Discord.
No local app settings or runtime files were changed.
