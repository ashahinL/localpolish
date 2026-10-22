# Continue 1.4 on another machine

The owner stopped work after T23e on 22 October 2026. Do not start the next task until asked. The checkpoint is the T23e commit on `main`, with parent `7f9d13f`. Run `git log -1 --oneline` after pulling to identify it. The package is still version 1.3.0. No 1.4.0 release exists.

## What is done

T23a–e are implemented and reviewed: side-panel gesture spike, multi-turn providers, local history, chat UI/runtime, and all four entry points. The source build has Copy. It does not insert chat answers into fields yet. The [feature plan](plans/features-1.3-1.4.md) contains the task details and final gate results.

Review fixed password selection caching, failed chat-settings saves, stale settings reads, unsafe Markdown nesting, and repeated scans of unmatched markers. Tests use fake text and mock providers. The final production native context-menu and physical shortcut checks remain in the manual release pass; the disposable spike already proved the gesture routes. T23d's real-panel rendering and saved history were inspected on the Mac.

## Set up the new machine

1. In the checkout, run `git pull --rebase`. Stop if it conflicts. Confirm `git status --short` is clean and inspect `git log -1 --oneline`.
2. Run `npm ci`, then `npx playwright install chromium` and `npm run build`. Load the checkout's `dist/` folder unpacked in Chrome and reload test tabs after extension changes.
3. For CLI providers, install the desired CLI, run `npm run bridge:install` from this checkout, and complete the machine's provider logins as described in the [README](../README.md). The wrapper records this machine's repo and runtime paths. Do not copy the old Mac's wrapper or temporary harnesses.
4. Configure this browser's settings and keys. Chrome extension settings, API keys, chat history, and transient attachments do not sync to the other machine. Native messaging setup and CLI authentication are local too.

## Resume point

Next is **T23f**, insertion into the last text field, using the existing `applyReplacement` path. T23e records an entry's tab/frame under window-scoped session storage; `readChatTarget(sequence)` is the helper prepared for insertion. Recheck active tab, frame, field ownership, and changed or removed targets before writing. Do not infer the target from a rendered data attribute.

Then complete **T23g**. The current README, privacy policy, manual checklist, changelog and release instructions already cover T23a–e. Add Insert behavior and the combined selection-to-chat-to-mock-answer-to-Copy-and-Insert browser test. Keep T23g unchecked until that work is complete.

**T25** remains separate. Refresh screenshots, perform native gesture and long-article checks with CLI and API providers, and follow [RELEASING.md](../RELEASING.md). The owner still needs to schedule the paid language-preservation benchmark and Windows Antigravity login check.

## Checks and processes

Run lint, typecheck, unit tests, formatting, build, and the full browser suite before committing a future code task. Exact commands and the checkpoint results are in the feature plan. A sandbox may block browser launch; report that and run browser checks from an unrestricted terminal. Do not weaken tests or use paid providers as a workaround.

No delegate, dev server, browser harness, or mock server should remain running at the checkpoint. Final checkpoint gates passed: lint, typecheck, 806 unit tests passed with 2 skipped, formatting, build, and 230 browser tests. The 77 targeted browser tests and local documentation links also passed. The feature plan records the manual checks still needed. Comment Sicko was unavailable; code, tests, and documentation were reviewed by the orchestrator. No reusable skill was created. The e2e provider guard may be worth extracting into a shared helper when it is used again.
