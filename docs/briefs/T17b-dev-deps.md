# T17b. Remove the vulnerable test dependency chain

Fixes audit A19 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Small task.

## Problem

`npm audit` reports two high entries: `immutable <=3.8.3` (three advisories) and `draft-js`, which depends on it. `draft-js@0.11.7` is a dev dependency used only by the Draft.js test fixture (`tests/e2e/fixtures/main.js:3`). It is not in the release zip, and `npm audit --omit=dev` is clean. npm suggests `npm audit fix --force`, which would downgrade to `draft-js@0.7.0`. Do not do that.

`immutable@3.8.4` exists on npm (checked 18 October 2026), one version past the vulnerable range.

## Steps

1. Run `npm view immutable@3.8.4` and the advisory pages to confirm 3.8.4 is outside every reported range. If it is not, stop and report.
2. Add to `package.json`:
   ```json
   "overrides": { "draft-js": { "immutable": "3.8.4" } }
   ```
   Then `npm install --cache /tmp/npm-cache-localpolish`, so `package-lock.json` updates.
3. Check `npm ls immutable` shows `3.8.4` under `draft-js`.
4. Run `npm audit` and `npm audit --omit=dev`. Both should report no high finding.
5. Run the Draft.js e2e tests: in `tests/e2e/editable.spec.ts` ("Draft.js updates its editor state", line 87), `tests/e2e/extension.spec.ts` ("Draft.js via the floating button", line 140), and the Draft.js idle Fix tests in `tests/e2e/popup.spec.ts` (search for `draft`). Then the full e2e suite.
6. If the Draft.js tests fail with 3.8.4, revert, and instead add a short "Known dev-only advisory" note to `SECURITY.md`: the package is only in a local test fixture, it never handles untrusted input, and it is not shipped. Report that you took this path.

## Done when

- `npm audit` has no high finding, or `SECURITY.md` explains the one that stays.
- All Draft.js tests still pass.
- The release zip is unchanged (`npm run build`; no runtime file changes).

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not run `npm audit fix --force`.
- Add one line under `## Unreleased` in `CHANGELOG.md`, in the For contributors group.
- One commit, message `T17b: <summary>`. Tick T17b in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What changed. The `npm audit` output before and after. Gate results.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
