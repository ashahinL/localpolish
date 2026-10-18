# T15e. Bridge cleanup and wrapper quoting

Fixes audit A07 and A08 ([audit](../audits/1.0.0.md)). Lane: Sol medium.

## 1. A07: a CLI's child can outlive a cancel

**Problem.** In `bridge/host.mjs`, `killChild()` (lines 153-175) sends SIGTERM to the CLI's process group and sets `killTimer` to send SIGKILL after `KILL_AFTER_MS` (2 s). But `done()` inside `finish()` (line 186) and the `child.on('close')` handler (line 244) both clear `killTimer` as soon as the direct child exits. A grandchild that ignores SIGTERM and does not hold the CLI's stdout keeps running after the bridge exits.

**Fix.**

1. Move `killGroup` out of `killChild` so `done()` can call it.
2. Remove `clearTimeout(killTimer)` from the `child.on('close')` handler.
3. In `done()`: if `killed` is true and the platform is not Windows, clear `killTimer` and call `killGroup('SIGKILL')` once, right away, before `removeDir()` and `exitWhenFlushed()`. The leader has exited, so anything left in the group is a leftover. `killGroup` already ignores the error when the group is empty.
4. Do not delay the `done` frame. It is already written before `done()` runs (line 184).
5. Windows: `taskkill /T /F` already kills the whole tree at once. No change there. T17c adds a Windows test.

**Test.** In `bridge/host.test.mjs`, next to "kills the cli when Chrome closes stdin" (line 165). Skip it on Windows (`it.skipIf(process.platform === 'win32')`), as the existing process-group test does.

- The fake CLI script starts a grandchild with `spawn(process.execPath, ['-e', script], { stdio: 'ignore' })` (same process group, not detached). The grandchild runs `process.on('SIGTERM', () => {})`, writes its pid to a file in the test's temp dir, and stays alive with `setInterval(() => {}, 1000)`.
- The fake CLI waits until the pid file exists, then also waits forever.
- The test closes the host's stdin (as the test at line 165 does), waits for the host to exit, then polls for up to 3 s until `process.kill(pid, 0)` throws `ESRCH`.
- In `afterEach`, kill the grandchild with SIGKILL if it is still alive, so a failing test leaves nothing behind.
- Keep every existing host test passing, especially "sends done at the end_turn stop and stops a cli that keeps running" (line 136).

## 2. A08: the macOS wrapper runs `$(…)` in paths

**Problem.** `bridge/install.mjs:65` writes the macOS wrapper with paths inside shell double quotes:

```sh
export PATH="<dirs>"
exec "<nodePath>" "<hostPath>"
```

Inside double quotes the shell still expands `$(…)`, backticks and `$VAR`. A repo folder named `repo-$(touch expanded)` runs that command when Chrome starts the bridge.

**Fix.**

1. Add `const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";` next to `cmdText` (line 56).
2. Write `export PATH=${shellQuote(dirs.join(':'))}` and `exec ${shellQuote(nodePath)} ${shellQuote(hostPath)}`.
3. Leave the Windows `.cmd` branch as it is.

**Test.** In `bridge/install.test.mjs`, in the macOS group (`describe.runIf(process.platform === 'darwin')`, line 25), model it on "writes an executable wrapper and a Chrome manifest" (line 26):

- Install into a temp repo dir named ``repo $(touch expanded) 'q' "d" `b` é``. Put a fake `bridge/host.mjs` there that writes `ok` to a file and exits.
- Run the generated wrapper. Expect the `ok` file, and expect no file named `expanded` anywhere in the temp dir or the current dir.
- Keep the Windows group passing (it only runs on Windows; T17c adds a Windows CI job).

**Release note for T17a.** People with a normal repo path do not need to reinstall the bridge. Only a path with `$`, a backtick or `"` needs `npm run bridge:install` again. So this is not a setup change that forces a major version.

## Done when

- After a cancel, no process from the CLI's group survives the bridge.
- The wrapper starts the host from a path full of shell characters, and runs none of them.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Do not run `npm run bridge:install` against the owner's real bridge registration; the tests use temp dirs.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Safer group.
- One commit, message `T15e: <summary>`. Tick T15e in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A07 and A08. Files touched. Gate results. Anything you could not verify, such as Windows.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
