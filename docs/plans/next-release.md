# LocalPolish next-release plan

Status: released as [LocalPolish 1.1.0](https://github.com/ashahinL/localpolish/releases/tag/v1.1.0) on 20 October 2026. T15-T20 and all release checks are complete. The published zip was downloaded, its SHA-256 verified, and the extracted extension tested in a fresh browser profile. The deferred backlog stays outside this release.
Based on: [the 1.0.0 audit](../audits/1.0.0.md) (Sol, 18 October 2026) and Claude's review of it below.
Baseline: `v1.0.0`, commit `71d5cbf`.

The original [T0-T14 plan](../plan.md) stays as the first-release record. This plan continues with T15.

## How to run this plan

- Each task has a brief in `docs/briefs/`. The brief holds everything the implementer needs: files, lines, steps, tests and the done check.
- Follow the `implement-plan` skill in its light form: build, test, keep this file current, report. Skip the guard skills and the final review pass. The owner reviews each diff.
- One commit per task. Tick the task's box in this file in the same commit. Then move to the next ready task, unless it needs the owner.
- Run `git pull --rebase` before every push. Stop if it conflicts.
- Never use real drafts. Never press Send, Post, Reply or Comment. Do not call paid providers or the real CLIs in tests. Use the mock OpenAI server and fake CLI scripts that the tests already have.
- Keep the version unchanged during implementation. The owner authorized the 1.1.0 release version change on 20 October 2026.
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
- [x] **T16b. Failed saves stay pending; the idle switch on the options page** (A10, A18). Sol medium. Brief: [T16b-save-errors.md](../briefs/T16b-save-errors.md). Depends on: T16a.

## T17: docs, dependencies and CI

- [x] **T17a. Privacy, release guide and bench docs** (A17, A22). Sol medium. Brief: [T17a-docs.md](../briefs/T17a-docs.md). Depends on: T15 and T16, so the docs describe the finished behavior.
- [x] **T17b. Remove the vulnerable test dependency chain** (A19). Sol medium. Brief: [T17b-dev-deps.md](../briefs/T17b-dev-deps.md). Depends on: nothing.
- [x] **T17c. Bridge tests on macOS and Windows, and Node 22 in CI** (A20). Sol medium. Brief: [T17c-ci.md](../briefs/T17c-ci.md). Depends on: T15e, T17b.
- **A21. Branch protection.** Skipped by the owner on 18 October 2026.

## T18: product additions (after T15-T17)

- [x] **T18a. Final-text view in the rewrite popup** (F02). Art lane (Claude Opus). Brief: [T18a-final-view.md](../briefs/T18a-final-view.md). Depends on: T15c.
- [x] **T18b. First-run setup** (F01). Art lane (Claude Opus). Brief: [T18b-first-run.md](../briefs/T18b-first-run.md). Fix while I type stays on by default (owner, 18 October 2026). Depends on: T16b.
- [x] **T18c. Keep API keys out of content scripts** (F03). Sol high. Brief: [T18c-key-isolation.md](../briefs/T18c-key-isolation.md). Depends on: T15a, T15b, T16a.

## T19: usage stats (owner request, 19 October 2026)

- [x] **T19a. Record local per-provider/model request attempts.** Sol medium. Brief: [T19a-usage-tracking.md](../briefs/T19a-usage-tracking.md). This includes connection tests and failed attempts. Cached answers do not count. Earlier usage cannot be recovered.
- [x] **T19b. Show Usage in Home and options.** Art lane, Claude Opus. Brief: [T19b-usage-ui.md](../briefs/T19b-usage-ui.md). Depends on T19a's data contract. No draft history, keys, or site details are stored in stats.
- [x] **T19c. Align the options idle checkbox.** Small inline fix. Brief: [T19c-checkbox-layout.md](../briefs/T19c-checkbox-layout.md). Owner reported the stretched checkbox on 19 October 2026.

## T20: safe Accept fallback after page paste handlers

- [x] **Implemented.** Sol high. Brief: [T20-safe-accept-fallback.md](../briefs/T20-safe-accept-fallback.md). Recheck both selection endpoints and selected text before native `insertText`. Preserve paste-first behavior, line-break normalization, and waits.
- [x] **Targeted verified.** The orchestrator reproduced both failures in Chromium against the old source: the rewrite overwrote `#other` or replaced text changed during paste. All 30 editor tests pass with the fix. The implementer's sandbox blocked port 5179, so the orchestrator ran the browser checks.
- [x] **Orchestrator full gates.** Lint, typecheck, 302 unit tests, formatting, build, and 136 browser tests passed. Two platform-specific unit tests were skipped on macOS. Full CI and platform checks run again after push.

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

- [x] All gates pass: lint, typecheck, 302 unit tests with two platform-specific skips on macOS, Prettier, build, and 136 browser tests.
- [x] `npm audit` (full and `--omit=dev`) has no unreviewed high finding.
- [x] CI is green at release commit `564575b`: [full gates](https://github.com/ashahinL/localpolish/actions/runs/39327447448) and [macOS, Windows, and Node 22](https://github.com/ashahinL/localpolish/actions/runs/39327466074).
- [x] Owner's requested provider and editor checks: rewrite fixed sample text with the configured Claude CLI, Codex CLI, and API provider in Discord and a plain text box; Accept inserts the correction and Backspace works. Owner reported "passed" on 19 October 2026. Individual platform and provider results were not listed.
- [x] Blocked embedded-editor check, completed by the orchestrator in Chromium instead of asking the owner to construct a test page. Loaded the extracted local zip in a fresh profile, blocked the parent through the real options page, and typed fixed sample text into cross-host, `srcdoc`, and `about:blank` frames. Each sent zero requests and showed no marker or selection button after 4.5 seconds. Unblocking produced one request and its marker. The provider was the local mock; no real drafts or providers were used.
- [x] Local package preflight: zip integrity and contents passed; the extracted extension installed in a fresh profile, Test connection reached the local mock with the fake key, and Usage recorded both the test and the unblocked rewrite. That preflight used version 1.0.0; it is not the 1.1.0 release asset.
- [x] Refreshed toolbar screenshots with `npm run shots` and opened all five images. Finalized [1.1.0 release notes](../releases/1.1.0.md) after the owner authorized publication. Version, changelog release heading, and install zip name are set for 1.1.0.
- [x] Published `v1.1.0` under the corrected `RELEASING.md`. Downloaded the public zip and `SHA256SUMS`, matched both to the build and GitHub asset digest, loaded the extracted zip in a fresh Chromium profile, confirmed manifest version 1.1.0, and pressed Test connection using the local mock. Usage recorded the test; three blocked frame types sent no requests; an unblocked frame sent one. No merged task branches or extra worktrees remain.

## Implementation notes

- Published 1.1.0 on 20 October 2026, tag `v1.1.0`, commit `564575b`. Zip SHA-256: `c6e0ea772b9417c794f46cab7c089f579f045cd6ae0b30b8eeb758e9a6c37ed4`. The published download and browser verification reports, screenshots, and reproducible script are saved in the task's `release-1.1.0` artifact folder. All release checks passed; no real rewrite CLI or paid provider was used in automated checks.

- Release day, 20 October 2026: all local gates and both dependency audits passed at version 1.1.0. The release commit is pushed to `main` before tagging so full CI and the manually dispatched platform jobs can verify that exact commit. The tag and public release follow those checks. No real rewrite CLI or paid provider is used in automated verification.

- Release preflight, 19 October 2026: full CI passed at `d1cda7a` ([run](https://github.com/ashahinL/localpolish/actions/runs/39317793313)); macOS, Windows, and Node 22 passed at the unchanged implementation commit `889daba` ([run](https://github.com/ashahinL/localpolish/actions/runs/39314908124)). The local zip contains 21 built-extension files and no source, tests, bridge, dependencies, or source maps. SHA-256: `ac9ce6dcac5abbeb17558eb88762da7ac68cbe96742b5cc7b49b61062e25eacc`. Browser and package reports, the reproducible check script, and screenshots are saved in the task's `release-preflight` artifact folder. This replaces only the remaining owner iframe check; published-package verification still requires an actual release.

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

- T16b: all gates passed, with 262 unit tests passed, 2 platform-specific tests skipped, and 111 browser tests passed. All 26 settings-page browser tests passed separately. Failed saves stay pending; both test controls stop on a failed flush; options can change idle Fix. Reusable skill: none.

- T17c remote verification passed on macOS, Windows, and Ubuntu Node 22: [platform run](https://github.com/ashahinL/localpolish/actions/runs/39157484975). The platform jobs include the real Windows process-tree test.

- T17a: updated privacy claims, Sites labels, release steps, and dated benchmark notes. Lint and typecheck passed; 64 targeted unit tests passed across 4 files. Changed-file formatting passed. All gates passed: 262 unit tests, 2 platform-specific skips, and 111 browser tests. Version and benchmark numbers are unchanged. Reusable skill: none.

- T18c: the orchestrator's Chromium preflight confirmed that restricting local storage to trusted contexts rejects content-world reads and suppresses storage change events. The background now applies that restriction at every worker start and sends only blocklist, idle Fix, and default mode settings to content scripts, with change notices to all tabs. Lint and typecheck passed; 14 targeted unit tests passed in 1 file. Added 1 browser regression using the extension's actual CDP execution context and a bearer-key assertion against the mock server. All gates passed: 269 unit tests, 2 platform-specific skips, and 112 browser tests. The real content-world storage and live-settings regression passed. Version unchanged. Reusable skill: none.

- T18a: all gates passed, with 272 unit tests, 2 platform-specific skips, and 115 browser tests. Changes and Final were checked in light and dark mode, including a 320-pixel viewport. The view persists across answers and opens automatically after failed Accept and Copy. Reusable skill: none.

- T18b: all gates passed, with 292 unit tests, 2 platform-specific skips, and 117 browser tests. A fresh profile opened setup, tested the mock provider, saved idle Fix off, sent nothing after typing, and closed with Done. Update reasons open no setup tab in unit tests. Missing-bridge idle errors stay quiet; manual errors remain visible. Setup was checked in light and dark mode. The install listener and test fixture were combined with T18c during integration. Version unchanged.

- Final local dependency checks: full and production-only audits both report zero vulnerabilities. No real providers or rewrite CLIs were used.

- Fleet skill reports: all delegates said none, except T18b suggested a note for sandboxed worktrees with linked node_modules, using wxt prepare and vitest --configLoader runner. The orchestrator agrees this is a short operating note, not enough for a new skill.

- Final implementation verification at `f1b6c4c`: [full CI](https://github.com/ashahinL/localpolish/actions/runs/39158863446) and [macOS, Windows, and Node 22](https://github.com/ashahinL/localpolish/actions/runs/39158871142) passed. All task worktrees are archived, the dev server is stopped, and the working tree is clean. The release checklist stays open for the owner's manual provider checks, release version, and published-package verification.


- T19a: added local all-time attempt counts by provider and exact selected model, with a serialized writer and recovery after storage failures. Only the background records usage. Already-aborted requests do not count; cancellation during the count save still counts but does not start the provider. Both provider timeouts start after the count save. Counts saturate at the largest safe integer. Added a built-extension regression for manual requests, cached mode answers, retry, model separation, and trusted-page persistence. Updated privacy and changelog. Passed `npx vitest run src/core/usage.test.ts src/background/rewrite.test.ts src/background/entrypoint.test.ts` with 35 tests across 3 files, `npm run lint`, `npm run typecheck`, and changed-file Prettier checks. Integration gates passed with T19b and T19c present: lint, typecheck, 302 unit tests, 2 platform-specific skips, formatting, build, and 126 browser tests. The real counter and content-world privacy regressions passed. The implementer used no real provider, rewrite CLI, or bridge install. The orchestrator ran the browser checks and owns the commit. Version unchanged. Reusable skill: none.

- T19b: Home and options show provider, exact selected model, request count, and a total. An empty model is labelled Provider default. The shared hook refreshes after usage changes and shows read errors rather than a false zero. All integration gates passed: 302 unit tests, 2 platform-specific skips, and 126 browser tests, including 8 usage-display regressions. Options and popup were checked in light and dark mode at 360 pixels, with a long custom model name. These screenshots use seeded test counts. Lint, typecheck, formatting, and build passed. Reusable skill: none.

- T19c: reproduced the checkbox stretched to 312 pixels by the shared input rule. Checkboxes are now excluded from text-input styling, and the 16-pixel checkbox sits beside its clickable label with an accessible description. Checked the built Defaults card at desktop and 360-pixel widths in light and dark mode. Existing toggle-save browser tests pass both stored states and both save directions. The shared integration gates passed, with 302 unit tests, 2 platform-specific skips, and 126 browser tests. Version unchanged. This small fix was done inline; no reusable skill was needed.
