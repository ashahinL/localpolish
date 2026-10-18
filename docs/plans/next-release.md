# LocalPolish next-release plan

Status: in progress. T15 and T16a are verified and committed. Remaining ready tasks continue automatically.
Based on: [the 1.0.0 audit](../audits/1.0.0.md) (Sol, 18 October 2026) and Claude's review of it below.
Baseline: `v1.0.0`, commit `71d5cbf`.

The original [T0-T14 plan](../plan.md) stays as the first-release record. This plan continues with T15.

## How to run this plan

- Each task has a brief in `docs/briefs/`. The brief holds everything the implementer needs: files, lines, steps, tests and the done check.
- Follow the `implement-plan` skill in its light form: build, test, keep this file current, report. Skip the guard skills and the final review pass. The owner reviews each diff.
- One commit per task. Tick the task's box in this file in the same commit. Then move to the next ready task, unless it needs the owner.
- Run `git pull --rebase` before every push. Stop if it conflicts.
- Never use real drafts. Never press Send, Post, Reply or Comment. Do not call paid providers or the real CLIs in tests. Use the mock OpenAI server and fake CLI scripts that the tests already have.
- Do not change the version in `package.json`.
- Lanes: Sol medium for normal tasks, Sol high for the tasks marked "high". UI-heavy tasks (T18a, T18b) are marked for the art lane (Claude Opus), because Sol is weak at UI.

## Review of the audit

Claude checked every finding against the code at `7e35740`. All 22 are real. The code does what the audit says. Some priorities are too high, and some proposed fixes are bigger than needed. The table shows the changes.

| ID  | Audit | Review | Note                                                                                                                                                                                  |
| --- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | P1    | P1     | True. Editors in iframes (TinyMCE, CKEditor, `srcdoc`) on a blocked site still send text automatically.                                                                                |
| A02 | P2    | P2     | True. An old marker stays and can send after the site is blocked.                                                                                                                      |
| A03 | P1    | P2     | True, and a one-line fix (`el.spellcheck`). Lower risk than A01: the page must turn spellcheck off on a parent.                                                                       |
| A04 | P2    | P3     | True, but needs the selection to move to another editor inside a 50 ms wait. A user cannot do that by hand; only page scripts can. Small fix, so still in scope.                        |
| A05 | P2    | P3     | True. Needs a paragraph split change between opening the popup and Accept.                                                                                                             |
| A06 | P1    | P3     | True, but the user must type a domain that starts with `127.` as their own base URL. No page can set it. Three-line fix.                                                               |
| A07 | P2    | P2     | True. `child.on('close')` clears the SIGKILL timer for the whole group.                                                                                                                |
| A08 | P2    | P3     | True, but only for a repo path that holds `$`, a backtick or `"`. Not reachable from a website.                                                                                       |
| A09 | P2    | P3     | True, but only when two extension pages save in the same few milliseconds. Fix with `navigator.locks` (about 5 lines), not a background writer with update messages.                  |
| A10 | P2    | P3     | True. `chrome.storage.local.set` almost never fails, but the hook drops the change when it does.                                                                                      |
| A11 | P2    | P3     | True. Only damaged storage reaches it. Nothing in the extension writes bad values.                                                                                                     |
| A12 | P2    | P2     | True. `[DONE]` returns before a `content_filter` ending is checked.                                                                                                                    |
| A13 | P2    | P3     | True. Only text that already is `<text>...</text>` is hit.                                                                                                                             |
| A14 | P3    | P3     | True. Flags and skin tones are not matched. `\p{RGI_Emoji}` with the `v` flag fixes it with no new package.                                                                            |
| A15 | P2    | P2     | True. The popup stores `example.com:8080`, which never matches. The UI says it is blocked, so this is a privacy promise that fails.                                                   |
| A16 | P3    | P3     | True. Fix: the parent frame ignores the shortcut when its active element is an iframe. No background routing needed.                                                                   |
| A17 | P2    | P2     | True. `PRIVACY.md:21-23` and `:64-65` are wrong.                                                                                                                                       |
| A18 | P3    | P3     | True. The options page has no Fix while I type switch.                                                                                                                                 |
| A19 | P2    | P3     | True, but the package is only in the test fixture. Nothing ships in the zip.                                                                                                          |
| A20 | P2    | P3     | True. Keep it cheap: macOS minutes cost 10 times Linux minutes on a private repo. Run only the bridge unit tests on macOS and Windows.                                                 |
| A21 | P2    | Skip   | True, but required checks would block the direct pushes to `main` that this project uses. The owner chose to skip it (18 October 2026).                                             |
| A22 | P3    | P3     | True. Step 6 pushes without `git pull --rebase`, and the bridge text is wrong: a pull alone updates `bridge/host.mjs`, because the wrapper runs it from the clone.                     |

Changes to the plan, compared with Sol's draft:

1. **Fewer, grouped tasks.** Most fixes are under 20 lines. 22 single-fix tasks would cost more in review than in code. Fixes that touch the same files are grouped into one task and one commit.
2. **Smaller fixes.** A01 uses `location.ancestorOrigins` in the content script, plus a background check for idle requests only. A09 uses `navigator.locks`. A15 fixes the one rule normalizer that every list goes through. A16 is a focus check in the frame.
3. **No forced major release.** Sol's draft said T15h (A08) forces a new bridge install, which `RELEASING.md` treats as a major release. It does not: the old wrapper keeps working for every normal path. Only people with a `$`, a backtick or a `"` in the repo path need to reinstall. So the next release can be 1.1.0. T17a updates `RELEASING.md` to say this.
4. **A21 is skipped** by the owner's choice. Pushes to `main` stay direct.
5. **Optimizations move to the backlog.** Nobody has reported the popup or idle Fix as slow. Measure first, in a later release.

## T15: privacy and draft safety

- [x] **T15a. Site blocking in every frame, one shortcut handler** (A01, A16). Sol medium. Brief: [T15a-frames.md](../briefs/T15a-frames.md). Depends on: nothing.
- [x] **T15b. Settings changes reach existing idle work** (A02). Sol medium. Brief: [T15b-live-settings.md](../briefs/T15b-live-settings.md). Depends on: T15a.
- [x] **T15c. Safe Accept in rich editors** (A04, A05). Sol high. Brief: [T15c-safe-accept.md](../briefs/T15c-safe-accept.md). Depends on: nothing.
- [x] **T15d. Small privacy and output fixes** (A03, A06, A12, A13, A14). Sol medium. Brief: [T15d-small-fixes.md](../briefs/T15d-small-fixes.md). Depends on: nothing.
- [x] **T15e. Bridge cleanup and wrapper quoting** (A07, A08). Sol medium. Brief: [T15e-bridge.md](../briefs/T15e-bridge.md). Depends on: nothing.

## T16: settings

- [x] **T16a. Safe settings writes, checked settings reads, one site rule** (A09, A11, A15). Sol medium. Brief: [T16a-settings-store.md](../briefs/T16a-settings-store.md). Depends on: nothing. Run it after T15a if both are open, because both touch `isBlocked` callers.
- [ ] **T16b. Failed saves stay pending; the idle switch on the options page** (A10, A18). Sol medium. Brief: [T16b-save-errors.md](../briefs/T16b-save-errors.md). Depends on: T16a.

## T17: docs, dependencies and CI

- [ ] **T17a. Privacy, release guide and bench docs** (A17, A22). Sol medium. Brief: [T17a-docs.md](../briefs/T17a-docs.md). Depends on: T15 and T16, so the docs describe the finished behavior.
- [x] **T17b. Remove the vulnerable test dependency chain** (A19). Sol medium. Brief: [T17b-dev-deps.md](../briefs/T17b-dev-deps.md). Depends on: nothing.
- [x] **T17c. Bridge tests on macOS and Windows, and Node 22 in CI** (A20). Sol medium. Brief: [T17c-ci.md](../briefs/T17c-ci.md). Depends on: T15e, T17b.
- **A21. Branch protection.** Skipped by the owner on 18 October 2026.

## T18: product additions (after T15-T17)

- [ ] **T18a. Final-text view in the rewrite popup** (F02). Art lane (Claude Opus). Brief: [T18a-final-view.md](../briefs/T18a-final-view.md). Depends on: T15c.
- [ ] **T18b. First-run setup** (F01). Art lane (Claude Opus). Brief: [T18b-first-run.md](../briefs/T18b-first-run.md). Fix while I type stays on by default (owner, 18 October 2026). Depends on: T16b.
- [ ] **T18c. Keep API keys out of content scripts** (F03). Sol high. Brief: [T18c-key-isolation.md](../briefs/T18c-key-isolation.md). Depends on: T15a, T15b, T16a.

## Backlog (not in this release)

| Item                    | Work                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| O01                     | Check the bridge only for CLI providers, and run the three version probes in parallel. Measure the popup first.   |
| O02                     | Idle markers poll every 250 ms while shown. Measure on a big editor and several tabs before changing it.          |
| O03                     | Cache the diff and token warnings for a finished answer. Measure a large answer first.                            |
| F04                     | Bridge version in the status, and a redacted diagnostics copy.                                                    |
| F05                     | Settings export without keys, import, and reset. Needs T16a's checked reads.                                     |
| F06                     | Named API profiles.                                                                                               |
| F07                     | Pause idle Fix for a field, tab or session.                                                                      |
| F08                     | A bridge package that does not run from the clone, and a Linux installer.                                       |
| Rephrase bench          | Add Rephrase and Shorter inputs to `bench/inputs.mjs`. Paid run, so the owner schedules it.                      |
| LinkedIn part selection | Known limitation. Copy keeps working.                                                                            |

## Release checks

- [ ] All gates pass: lint, typecheck, unit tests, Prettier, build, e2e (91 tests at 1.0.0, plus the new ones).
- [ ] `npm audit` (full and `--omit=dev`) has no unreviewed high finding.
- [ ] CI is green at the release commit, including the new macOS, Windows and Node 22 jobs.
- [ ] Owner, by hand on macOS and Windows: one rewrite each with Claude CLI, Codex CLI and one API provider, using fixed sample text. Block a site and check that an editor in an iframe on it sends nothing. Never submit a draft.
- [ ] Follow the corrected `RELEASING.md`. Download the published zip, check its SHA-256, load it in a fresh profile, and press Test connection.

## Implementation notes

- T15a: all gates passed. 224 unit tests passed, 1 Windows-only test skipped, and 94 browser tests passed. Each blocked iframe stays focused for the full idle delay in its regression test. Reusable skill: none.

- T15b: implemented A02. Settings refresh clears idle markers, cancels requests unless the manual popup adopted them, and refreshes the selection button. Lint and typecheck passed; 27 targeted unit tests passed across 3 files. Added 6 browser regressions. Browser checks and the complete final gates await the orchestrator before commit. Reusable skill: none.

- T15b: all gates passed, with 224 unit tests passed, 1 Windows-only test skipped, and 100 browser tests passed. The stale-marker regression uses a trusted click; its targeted rerun passed. Idle-off keeps the button and shortcut working, and an open popup retains its adopted answer. Reusable skill: none.

- T15c: all gates passed, with 224 unit tests passed, 1 Windows-only test skipped, and 105 browser tests passed. All 20 editor tests also passed separately, including both paste races, draft changes, paragraph splits, ignored line breaks, and Undo. Reusable skill: none.

- T15d: all gates passed, with 236 unit tests passed, 1 Windows-only test skipped, and 107 browser tests passed. Filtered responses, exact loopback hosts, literal text tags, whole emoji, and inherited spellcheck have regressions. Reusable skill: none.

- T15e: all gates passed, with 238 unit tests passed, 1 Windows-only test skipped, and 107 browser tests passed. Resistant descendants are killed and shell-special installation paths work. Windows is pending T17c. Reusable skill: none.

- T16a: all gates passed, with 262 unit tests passed, 1 Windows-only test skipped, and 107 browser tests passed. Shared Web Locks, damaged storage, and canonical site entries have coverage. As scoped, concurrent edits of entire model records for different providers can still overwrite each other. Reusable skill: none.

- T17b: Immutable is pinned to 3.8.4 under Draft.js. Full and production-only audits both report zero vulnerabilities, down from two high dev-only package entries. All gates passed: 262 unit tests, 1 Windows-only skip, and 107 browser tests. Every production build file is byte-for-byte unchanged by the override. No delegated work or reusable skill was needed.

- T17c: added dispatch/tag-only macOS and Windows bridge jobs and an Ubuntu Node 22 job, a Windows grandchild cleanup test, and the pre-tag dispatch command. Node 22 targeted tests passed: 84 passed and 3 Windows-only skips across 5 files. Lint, Node 22 typecheck, and changed-file formatting passed. The orchestrator still owns full gates, browser checks, commit, push, and remote workflow verification; no CI run link yet. The repo is public; the owner-approved dispatch/tag schedule stays unchanged. Reusable skill: none.

- T17c local verification: all gates passed, with 262 unit tests passed, 2 platform-specific tests skipped, and 107 browser tests passed. Remote platform verification follows the required push and dispatch.
