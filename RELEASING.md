# Releasing

How a version of LocalPolish gets from `main` to a GitHub release.

## The rule

**A version number is what people can download from a GitHub release.**
Nothing else gets one.

- A version, its tag and its GitHub release all happen on the same day.
  There is no tag without a release, and no release without a tag.
- Planned groups of work (the T-numbered tasks in `docs/plan.md`) are not
  versions. On release day, everything finished on `main` goes out together.

## Branches

- **`main` is where work lands.** Every gate passes at every commit, and
  nothing half-built lands. A feature that takes many commits lives on its
  own branch and merges into `main` when it is finished.
- The README on `main` describes what the latest release does, plus what is
  under `## Unreleased` in the changelog.

## Between releases

- Every change adds its line under `## Unreleased` at the top of
  `CHANGELOG.md`, in the groups New, Safer, Fixes, For contributors.
- The version in `package.json` changes only on release day. WXT writes it
  into the built `manifest.json`, so there is no second place to change.

## The number

- After `1.0.0`, new things or changes: next minor. `1.0.0` → `1.1.0`.
- Only bug fixes: next patch. `1.0.0` → `1.0.1`.
- Only a change that makes everyone redo setup (a new bridge install, a new
  login, a new extension ID): next major.
- A reinstall that only some people need: next minor. Say who must reinstall
  in the release notes. For example, T15e needs a reinstall only for repo
  paths with a `$`, a backtick, or a `"`.
- Numbers go up by one and never skip.
- `manifest.json` takes numbers and dots only. No `-beta`.

## Release day

1. **Check `main`.** Clean `git status`, and every gate green:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npx prettier --check .
   npm run build
   npm run test:e2e
   ```
   The last GitHub Actions run on `main` must be green too.
   Run `gh workflow run platforms.yml --ref main` and wait for it to pass before you tag.
2. **Test by hand.** Reload the extension on `chrome://extensions`, then
   reload the test tabs (an open tab keeps the old content script). Go
   through `docs/manual-checklist.md` for anything this version changed, and
   at least Fix, Rephrase and Accept in one plain textarea and one rich
   editor, with one CLI provider and one API provider. Check the toolbar
   popup's four tabs and both switches. For a chat release, also follow the assistant-chat section of the manual checklist: all four real entry points, the selected-text attachment, history deletion, window isolation, Copy, and Insert after T23f is complete. The owner checks a long article with one CLI and one API provider. Do not release 1.4.0 before the remaining T23f, T23g and T25 checks are complete.
3. **Images.** If the toolbar popup looks different, run `npm run shots` and
   open every image in `docs/screenshots` before committing it.
4. **Set the version** in `package.json` and `package-lock.json`:
   ```bash
   npm version X.Y.Z --no-git-tag-version
   ```
5. **Date the changelog.** Rename `## Unreleased` to `## X.Y.Z — YYYY-MM-DD`
   and start a new empty `## Unreleased` above it. Read the README against
   that section: a feature nobody can read about may as well not have
   shipped. Update the zip name in the README's Install section.
6. **Commit, rebase, tag and push.**
   ```bash
   git commit -am "Version X.Y.Z"
   git pull --rebase
   ```
   Stop if the rebase conflicts. If it brought in new commits, run the gates
   from step 1 again. After they pass, tag and push:
   ```bash
   git tag -a vX.Y.Z -m "LocalPolish X.Y.Z"
   git push origin main vX.Y.Z
   ```
7. **Pack and release.** `npm run pack` at the tag writes
   `dist/localpolish-X.Y.Z.zip`. Make the GitHub release `vX.Y.Z`, titled
   "LocalPolish X.Y.Z", with that version's changelog section as the notes,
   a line on how to install, the zip's SHA-256, and the zip attached:
   ```bash
   shasum -a 256 dist/localpolish-X.Y.Z.zip
   gh release create vX.Y.Z dist/localpolish-X.Y.Z.zip \
     --title "LocalPolish X.Y.Z" --notes-file notes.md
   ```
8. **Check the release.** Download the zip from the release page, extract
   it, load it unpacked, and press **Test connection** once.
9. **Delete merged branches.** Only delete branches Git lists as merged.
   Check local branches with `git branch --merged main`. Check remote
   branches with `git branch -r --merged origin/main`. Never delete `main`,
   `master`, `dev`, `develop`, `prod`, `production`, or `release*` branches.
   For each merged branch:
   ```bash
   git branch -d <branch>
   git pull --rebase
   git push origin --delete <branch>
   ```
   Stop if Git refuses the deletion or the rebase conflicts. Never force it.

## If the bridge changed

The release zip holds only the extension. The installed wrapper runs
`bridge/host.mjs` straight from the cloned repo. Changes to `bridge/host.mjs`
or `bridge/lib.mjs` reach people with `git pull` alone, from the next rewrite.

Run `npm run bridge:install` again only when the wrapper or Chrome native
messaging manifest changes (`bridge/install.mjs`), or when the repo folder
moves. Say which update people need at the top of that version's changelog
section and release notes.
