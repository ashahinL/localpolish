# Continue the 1.4 release checks

The owner resumed work on Windows after T23e on 22 October 2026. T23f adds insertion and T23g finishes the chat documentation and combined browser flow. Run `git log -1 --oneline` after pulling to identify the current checkpoint. The package is still version 1.3.0. No 1.4.0 release exists.

## What is done

T23a–g implement the side-panel gesture spike, multi-turn providers, local history, chat UI/runtime, all four entry points, Copy, and Insert into the remembered field. The [feature plan](plans/features-1.3-1.4.md) contains task details and gate results.

Review fixed password selection caching, failed chat-settings saves, stale settings reads, unsafe Markdown nesting, and repeated scans of unmatched markers. Tests use fake text and mock providers. The final production native context-menu and physical shortcut checks remain in the manual release pass; the disposable spike already proved the gesture routes. T23d's real-panel rendering and saved history were inspected on the Mac.

Insert binds the last focused supported field when a page entry opens chat. It replaces the whole field through `applyReplacement`. A changed or unavailable field, navigated frame, or inactive tab refuses insertion and keeps Copy available. Reopened history and chats started with New chat have no live target. Snapshot text stays inside content-script memory. Session storage holds only field identity and tab/frame ownership alongside the pending attachment.

## Set up the new machine

1. In the checkout, run `git pull --rebase`. Stop if it conflicts. Confirm `git status --short` is clean and inspect `git log -1 --oneline`.
2. Run `npm ci`, then `npx playwright install chromium` and `npm run build`. Load the checkout's `dist/` folder unpacked in Chrome and reload test tabs after extension changes.
3. For CLI providers, install the desired CLI, run `npm run bridge:install` from this checkout, and complete the machine's provider logins as described in the [README](../README.md). The wrapper records this machine's repo and runtime paths. Do not copy the old Mac's wrapper or temporary harnesses.
4. Configure this browser's settings and keys. Chrome extension settings, API keys, chat history, and transient attachments do not sync to the other machine. Native messaging setup and CLI authentication are local too.

## Resume point

Next is **T25**, the release checks. A pre-existing CI runtime-smoke failure was reproduced: `bench/runtime/compile.mjs` omits `src/background/outputBudget`, so every core probe fails during import. Fix and verify that prerequisite before release. Keep task changes in separate commits.

The README, privacy policy, manual checklist, changelog, release instructions, and plan index now describe Insert. The combined browser test selects fake article text, asks a local mock provider, copies its multiline answer, and inserts it into an empty textarea.

The five toolbar screenshots were refreshed and visually checked in T23g. Perform native gesture and long-article checks with CLI and API providers, and follow [RELEASING.md](../RELEASING.md). The owner still needs to schedule the paid language-preservation benchmark and Windows Antigravity login check. Do not call paid providers to bypass a test failure.

## Checks and processes

Run lint, typecheck, unit tests, formatting, build, and the full browser suite before committing a future code task. Exact commands and checkpoint results are in the feature plan. On this Windows machine, Playwright Chromium 156.0.8078.4 cannot start because Windows cannot resolve its side-by-side assembly, even after a forced reinstall. Local browser checks use installed Brave 155.1.97.59 through a temporary external launch hook, with the Mac-only single-process flag removed. The repository's browser configuration is unchanged. Chromium checks still belong in CI.

T23g gates passed: lint, typecheck, 811 unit tests with 9 platform skips, formatting, build, and 245 browser tests through Brave. The panel page was visually checked at 400 px after insertion. All five toolbar screenshots were inspected. Native panel insertion remains a manual release check. Comment Sicko was unavailable; code, tests, and documentation were reviewed by the orchestrator. No reusable skill was proposed or created. Stop all task-owned test servers and browsers before ending work.
