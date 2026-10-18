# T17c. Bridge tests on macOS and Windows, and Node 22 in CI

Fixes audit A20 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Do this after T15e (new bridge tests) and T17b (lock file change).

## Problem

`.github/workflows/test.yml` runs one job, `gates`, on Ubuntu with Node 24. The installer tests only run on their own OS (`bridge/install.test.mjs:25` macOS, `:119` Windows), and the process-group test skips Windows, so no CI run covers either platform the bridge supports. `package.json` promises Node 22 or newer, which CI never runs.

## Cost limit

The repo is private. GitHub bills macOS minutes at 10 times and Windows at 2 times the Linux rate, and agents push to `main` many times a day. So the new jobs must not run on every push.

## Steps

1. Leave the `gates` job in `test.yml` as it is.
2. Add `.github/workflows/platforms.yml`, triggered by `workflow_dispatch` and by pushed tags `v*`. Same pinned actions and `permissions: contents: read` as `test.yml`. Two jobs, each with `timeout-minutes: 10`:
   - **`bridge`**: matrix `os: [macos-latest, windows-latest]`, Node 24. Steps: checkout, setup-node with npm cache, `npm ci`, then `npx vitest run bridge/`. No browser install, no e2e.
   - **`node22`**: `ubuntu-latest`, Node 22. Steps: checkout, setup-node, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
3. **Windows tree test.** In `bridge/host.test.mjs`, add a Windows-only test (`it.runIf(process.platform === 'win32')`), the twin of the macOS grandchild test from T15e: the fake CLI starts a grandchild (`node -e "setInterval(() => {}, 1000)"`) that writes its pid to a file; the test closes the host's stdin, waits for the host to exit, and polls for up to 5 s until `process.kill(pid, 0)` throws. Kill the grandchild in `afterEach` if it is still alive. You cannot run this on the Mac; it runs in the `bridge` job.
4. **Node 22.** If any unit test fails on Node 22 (for example `navigator.locks` from T16a, or the regex `v` flag from T15d), fix the code or skip only that one test with a reason. Do not raise the `engines` field.
5. In `RELEASING.md` step 1 ("Check `main`"), add: run `gh workflow run platforms.yml --ref main` and wait for it to pass before you tag.
6. Push a branch or use `workflow_dispatch` once to prove both jobs pass. Put the run link in the report.

## Done when

- The macOS installer group, the Windows installer group and the Windows tree test each run on their own runner and pass.
- Node 22 runs typecheck, unit tests and build, and passes.
- Ordinary pushes still run only `gates`.
- All local gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- At the end, run all local gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not change GitHub repository settings.
- Add one line under `## Unreleased` in `CHANGELOG.md`, in the For contributors group.
- One commit, message `T17c: <summary>`. Tick T17c in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.

## Report

- What changed. The CI run links and their results. Anything still not covered on Windows.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
