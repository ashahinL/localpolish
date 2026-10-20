# Performance release plan

Status: implementation in progress. P11, P00a, P00b, P01a, P01b, P01c, and P01d are complete. P01e is next. The release version is not chosen.

Baseline: `227afbc`, after LocalPolish 1.1.0 and the Codex context reduction. Sources: the [review and accepted findings](../audits/performance-1.1.0.md), [original Grok proposals](../audits/performance-1.1.0-grok.md), and [review evidence](../audits/performance-1.1.0-evidence.json). The old [1.1.0 release plan](next-release.md) stays as a completed release record.

This file is the execution plan. The review records the evidence and decisions. Existing P IDs are preserved. Letters split a large review item into independent tasks.

## Run the tasks

- Use one task and one commit at a time. Update its status and verification notes in the same commit. Continue to the next ready task automatically when implementation is requested. This planning change does not start implementation.
- Use the index order unless a dependency or documented blocker prevents it. A blocker on P08a does not block unrelated tasks. Never edit the same files concurrently in two fleet lanes.
- Each task section is its dispatch brief. Read its listed functions and tests before writing. Resolve exact line ranges at dispatch, since earlier tasks move them. Do not send a delegate the whole review or a whole large source file.
- Delegates follow `implement-plan` in its light form: build, test, keep this plan current, report. They skip clean-code-guard, test-guard, docs-guard and final review. The orchestrator reviews every diff and owns integration. Send substantial findings back to the author; fix only very small findings inline.
- Lanes come from `~/.config/delegate-skills/config.json`. `feature` is Grok 4.7 high; `complex` is Sol high; `art` is Claude Opus high. Dispatch Grok with `--lane feature` and the relay's 500,000-token context setting. Use `second` Sol medium when the feature lane is unavailable, then the configured fallback. Sol effort stays medium or high. The one-time Grok xhigh review is finished.
- Every delegate report ends with: "Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none." Relay its answer with the reviewer's own view.
- Use synthetic drafts, local HTTP mocks and fake CLIs. Automated checks must not call real providers or rewrite CLIs. Optional live measurements are described separately below.
- Run targeted checks while working. At integration, run lint, typecheck, unit tests, formatting, build and the relevant browser suites. P13 repeats the full release checks after all changes. Do not replace behavioral checks with timing-only assertions.
- Before each push, run `git pull --rebase`. Stop on conflicts. Delete only merged, unprotected task branches with `git branch -d` and a remote delete. Do not change the version or publish a release under this plan.

## Task index

`[ ]` pending, `[~]` in progress, `[x]` implemented, reviewed and committed. Dependencies refer to completed tasks.

| Status | Task                                                          | Scope                                                                  | Lane         | Depends on              |
| ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ | ----------------------- |
| [x]    | [P11](#p11-remove-codex-rewrite-context)                      | Remove Codex coding context and unused tools                           | Complete     | None                    |
| [x]    | [P00a](#p00a-add-a-portable-runtime-benchmark)                | Establish the offline runtime baseline                                 | complex      | P11                     |
| [x]    | [P00b](#p00b-build-once-in-ci)                                | Remove the duplicate CI build                                          | feature      | None                    |
| [x]    | [P01a](#p01a-reject-oversized-input-before-an-attempt-starts) | Bound input before usage counting and provider startup                 | feature      | P00a                    |
| [x]    | [P01b](#p01b-bound-native-frames-and-cli-event-lines)         | Bound native frames and CLI event lines; remove repeated frame copying | complex      | P01a                    |
| [x]    | [P01c](#p01c-bound-sse-events-and-avoid-repeated-line-scans)  | Bound SSE buffering and avoid prefix rescanning                        | complex      | P01a                    |
| [x]    | [P01d](#p01d-bound-total-rewrite-output)                      | Bound total output and abort oversized answers                         | complex      | P01b, P01c              |
| [ ]    | [P01e](#p01e-bound-http-error-body-reads)                     | Bound error downloads for both API providers                           | feature      | P01c                    |
| [ ]    | [P02](#p02-skip-idle-scheduling-when-disabled)                | Avoid field discovery and timers when idle Fix is off                  | feature      | P00a                    |
| [ ]    | [P03a](#p03a-run-native-version-probes-together)              | Parallelize independent version commands                               | feature      | P00a                    |
| [ ]    | [P03b](#p03b-gate-automatic-bridge-checks-by-provider)        | Stop automatic native checks for API providers                         | art          | P00a                    |
| [ ]    | [P03c](#p03c-share-and-cache-bridge-health-results)           | Share in-flight health work and briefly cache success                  | complex      | P03a, P03b              |
| [ ]    | [P04](#p04-debounce-selection-geometry)                       | Measure selection geometry after the debounce                          | art          | P00a                    |
| [ ]    | [P05](#p05-reuse-completed-result-analysis)                   | Lazily reuse completed diffs and static token notes                    | art          | P00a                    |
| [ ]    | [P06](#p06-cancel-abandoned-connection-tests)                 | Cancel tests when their extension page goes away                       | complex      | P01d                    |
| [ ]    | [P07](#p07-coalesce-marker-work)                              | Reduce duplicate marker reads and renders                              | art          | P02, P00a               |
| [ ]    | [P08a](#p08a-prove-hidden-document-state-in-a-browser)        | Establish a reliable hidden-page browser fixture                       | complex      | P00a                    |
| [ ]    | [P08b](#p08b-defer-new-idle-requests-while-hidden)            | Gate automatic request starts on visibility                            | feature      | P08a, P02, P07          |
| [ ]    | [P09](#p09-stop-posting-unused-idle-chunks)                   | Suppress idle preview messages at the worker boundary                  | feature      | P01d                    |
| [ ]    | [P10](#p10-filter-and-order-sanitized-settings-updates)       | Send relevant settings once and preserve newest state                  | complex      | P02, P03c               |
| [ ]    | [P12](#p12-measure-the-request-lifecycle)                     | Measure where request time goes, without changing models               | complex      | P00a, P11, P06, P09     |
| [ ]    | [P13](#p13-verify-the-release-candidate)                      | Run integration, privacy, platform and package checks                  | Orchestrator | All pending tasks above |

There are 22 tasks: seven completed and 15 pending. P08a and P08b split the review's P08. P00, P01 and P03 are also split. P12 adds request-time measurement because token savings alone did not establish faster replies. P13 records candidate verification, not publication.

## Shared behavior to preserve

Idle Fix remains on by default with the current three-second pause and minimum-word rule. Blocked ancestors, inherited spellcheck behavior and cross-origin or blank editor frames retain their protections. Manual shortcuts keep their existing blocked-site behavior.

An attempt counts once when accepted work starts, including later failure or cancellation. Invalid or oversized input rejected before that point does not count. Cancellation during the existing usage save still counts but cannot start the provider afterward. Cached mode answers do not count again.

Keep safe Accept, Copy fallback, Undo, Backspace, line breaks, modal placement, cached choices and popup adoption of idle answers. Keep local storage restricted to trusted contexts. Send only `blocklist`, `idleFix` and `defaultMode` to content scripts. Never persist drafts or introduce a cross-site result history.

Use the new baseline for before/after comparisons. Keep historical review measurements dated. Fewer callbacks, tokens or copies do not by themselves prove faster model replies or lower battery use.

## P11. Remove Codex rewrite context

Status: complete, commit `227afbc`, pushed to `main`.

The [completed task record](codex-context.md) covers the implementation, cache-refresh fallback, request capture, live token counts and quality limits. The same fragment used 781 input tokens on both Luna and Sol after reduction, compared with about 9,360 before. The broader Luna sample passed 18/21 checks after removal and 16/21 before. Sol passed 5/5 in both small samples. A general latency improvement is unproven. Do not redo this task or change the user's global skills or fleet settings.

## P00a. Add a portable runtime benchmark

Status: complete, commit `acad41b`, pushed. Two smoke runs, the full 300-sample baseline, all 136 browser tests, and crash-prevention checks passed. The first Linux CI run also passed and uploaded the runtime artifacts.

Source: S05. Files: new offline harness under `bench/runtime/`, `package.json`, `.github/workflows/test.yml`, and the existing fixtures in `tests/e2e/extension.spec.ts` and `tests/e2e/mock-openai.ts`.

1. Turn the useful one-off probes in the review evidence into checkout-relative tooling. Use the built extension, local mock responses and fake native CLIs. Share or extract existing fixtures rather than copying the full browser test setup.
2. Add `npm run bench:runtime` as an offline command. Measure first preview, ready result, repeated Changes/Final views, selection work, marker work, request/message/process counts, cancellation and fragmented streams. Include small, large, multilingual and pathological fixtures.
3. Distinguish a fresh browser/worker run from a repeated request in the same context. In full mode, record versions, input sizes, raw samples, ten cold runs and ten warm runs. Report medians and maxima. Do not call these small samples population percentiles. Provide a CI smoke mode with one cold and one warm iteration per scenario, gated by work counts rather than wall time.
4. Add repeated open/close checks for retained DOM, listeners and pending work. Save heap measurements as observations, since garbage collection makes a universal heap threshold unreliable.
5. Store the full local baseline under `bench/results/`. Run smoke mode in CI after its existing build/browser installation and upload the report and raw samples as artifacts. Keep smoke mode within the job's existing timeout. Establish timing budgets from repeated evidence; do not turn the review machine's 201 ms sample into a universal CI deadline.

Done: the command runs without login or paid calls on a clean checkout after build; records the actual ready event rather than CLI exit; reproduces the reviewed problems; uploads its report. Run it twice and compare scenario coverage and counts. This task establishes tooling, without optimizing production code.

## P00b. Build once in CI

Status: complete, commit `9a1ac8e`, pushed. `npm run build` followed by `npx playwright test --workers=2 --max-failures=1` passed all 136 browser tests. The workflow has one production build. The [first remote CI run](https://github.com/ashahinL/localpolish/actions/runs/39374910726) passed all gates, including the new runtime smoke and artifact upload.

Source: S05. Files: `.github/workflows/test.yml`, `package.json`.

Keep `npm run test:e2e` as the standalone build-and-test command. In CI, retain the existing explicit build and run `npx playwright test` against that output. Keep browser installation and all existing suites.

Done: the workflow has one production build, and the same browser suites pass against it. Validate the workflow diff, run `npm run build` followed by `npx playwright test`, and verify the first remote CI run. Do not change browser coverage or dependency versions.

## P01a. Reject oversized input before an attempt starts

Status: complete in this task commit. Implemented by Grok 4.7 high and reviewed locally. ASCII, Arabic, and emoji cases cover exactly one byte below, at, and one byte above the cap.

`runRewrite` rejects raw text over 262144 UTF-8 bytes before `recordUsage` and before a provider starts. Input at exactly 262144 bytes is kept and sent inside the existing `<text>` frame. ASCII, Arabic, and emoji are counted in bytes. The native host rejects an already framed prompt over 262159 bytes, which is 256 KiB plus the 15-byte `<text>` wrapper, before CLI lookup, Codex login, a temp directory, or spawn. The error is `This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.` The text is not shortened.

Reviewer verification passed: lint, typecheck, 331 unit tests with 2 skipped, formatting, build, all 26 built-extension tests, and all 15 runtime smoke scenarios with 30 samples. The browser regression confirms the error, disabled Accept, zero provider requests, and unchanged stored usage. No real provider calls were used.

Source: S01. Files: `src/entrypoints/background.ts` request handling, `src/background/rewrite.ts::runRewrite`, `bridge/host.mjs::handleRewrite`, `bridge/constants.mjs`, and their existing tests. Add browser-side limit definitions where needed.

Use these release limits, measured in UTF-8 bytes. They are product resource limits, not model context-window limits:

| Boundary                                        | Limit                                 | Owning task |
| ----------------------------------------------- | ------------------------------------- | ----------- |
| User input text                                 | 256 KiB                               | P01a        |
| Total generated text                            | 1 MiB                                 | P01d        |
| Incoming native JSON frame payload              | 8 MiB, excluding its four-byte header | P01b        |
| One CLI stdout JSON event line                  | 8 MiB                                 | P01b        |
| An incomplete SSE line or accumulated SSE event | 1 MiB each                            | P01c        |
| Retained HTTP error response detail             | 8 KiB; display at most 300 characters | P01e        |

1. Reject input above 256 KiB before `recordUsage`, provider startup or native spawning. Send a clear error with the input limit. Do not silently ignore an invalid request or shorten the text.
2. Apply the input check to the background path and the native host boundary. Document the limit in README. Leave model, effort and prompt defaults unchanged.
3. Check just-below, exact-limit and just-above inputs using ASCII, Arabic and emoji. Keep character counts distinct from byte counts.

Done: rejected input starts zero providers and adds zero attempts; supported boundary-sized input is preserved exactly. Run `src/background/entrypoint.test.ts`, `src/background/rewrite.test.ts` and `bridge/host.test.mjs`, plus a built-extension mock-provider case showing the error and disabled Accept.

## P01b. Bound native frames and CLI event lines

Status: complete in this task commit. Sol high implemented the task; the reviewer checked every diff and fixed a duplicate terminal reply for coalesced invalid requests.

Native JSON payloads and CLI stdout event lines each have an 8 MiB byte cap. The four-byte native header and CR/LF line delimiters do not count. Native decoding uses a fixed header and one payload buffer, with each byte copied once. CLI lines use geometric buffer growth capped at 8 MiB and decode only at a delimiter or EOF. Decoder failures stop further input and send one framed error through active child-group cleanup. Line overflow uses the same kill/finish cleanup. Final events keep priority over trailing garbage.

Source: S01. Files: `bridge/lib.mjs::createDecoder`, `bridge/host.mjs` stdout handling, `bridge/constants.mjs`, `bridge/lib.test.mjs`, `bridge/host.test.mjs`.

1. Reject a native frame length above 8 MiB immediately after its header arrives. Handle incomplete frames without concatenating the entire pending prefix on every fragment. Support multiple frames and headers split across chunks.
2. Bound a CLI event line before unlimited buffering by the line reader. Preserve the current JSON parser and final-event behavior. Stop the child group on an oversized line and return one error. Decoder and line-limit failures must use the framed error/cleanup path, not raw stdout or an uncaught exception.
3. Retain outgoing surrogate-safe chunks and existing process-group cleanup. Add no new persistent process or protocol version.

Done: a valid 2 MiB frame split into 1 KiB pieces is decoded intact with linear copying; a copy-count experiment at 1, 2 and 4 MiB does not show quadratic growth. Oversized headers and endless CLI lines fail within their stated memory bounds. Split UTF-8, CRLF, multiple frames, aborts and resistant descendants still work. Run both bridge test files and the native scenarios from P00a.

## P01c. Bound SSE events and avoid repeated line scans

Status: complete, commit `f2197a9`, pushed. Reviewer checks passed: lint, typecheck, 383 unit tests with 2 skipped, formatting, build, four fixture checks, and all 15 runtime smoke scenarios.

Implemented: line and event caps are each 1 MiB of decoded UTF-8. Lines exclude LF and one final CR, including at EOF. Events count the current name and data with inserted newlines. Replacing the name replaces its contribution. Comments and unknown fields only count toward their line cap. Fresh fragments are searched and encoded once. Pieces join only at line completion or EOF. Completion, overflow, consumer break, cancellation rejection and AbortError release the reader lock. Overflow cancels upstream. These are retained-content limits, not total-transfer or exact heap limits.

Allowed verification passed on 2026-10-20, completed at 11:57 Africa/Cairo: targeted SSE/OpenAI/Anthropic tests, 62 passed; full unit suite, 25 files with 383 passed and 2 skipped; lint, typecheck, formatting and production build. Both provider regressions use existing fetch boundary mocks and observe cancellation with no text delivered. No real provider or CLI was called.

The `sse-1k` benchmark now has bounded 1/2/4 MiB aggregate streams, split Arabic/emoji at 1 KiB boundaries, exact event assertions, a final event at EOF, and an explicit oversized single-line rejection. It records actual LF search ranges and UTF-8 encoder inputs/bytes, checks that no prefix is revisited, and checks exact doubling of work increments. Native copy metrics and historical reports are unchanged. The implementer left runtime checks to the reviewer because of the sandbox restriction. The reviewer completed them outside the sandbox. The measured results are in [the SSE work record](../../bench/results/p01c-sse-work.json).


Source: S01. Files: `src/background/sse.ts::readSSE`, `src/background/sse.test.ts`, both API-provider test files.

Keep pending line and accumulated event data within the limits from P01a. Scan newly arrived portions instead of repeatedly searching the entire incomplete prefix. Preserve incremental decoding, multiline data, comments, CRLF and final events at EOF. Count retained UTF-8 bytes consistently across split characters. Cancel and release the reader on an overflow or consumer abort.

Done: normal events are unchanged; exact-limit events work; oversized lines/events fail clearly; a stream without newlines cannot grow without bound. Valid 1, 2 and 4 MiB aggregate streams made of bounded events show linear work under 1 KiB fragmentation. The review's oversized 2 MiB single line is now rejected, not silently accepted. Run the SSE and both API-provider test files and P00a's fragmented-stream cases.

## P01d. Bound total rewrite output

Status: complete in this task commit. Sol high implemented it; the reviewer checked every diff, fixed the empty browser draft fixture, removed an internal listener-call assertion, and restored the older host assertions.

The browser pipeline and direct native host count only each new raw text chunk toward a 1 MiB UTF-8 cap, before cleanup. A high surrogate followed by a low surrogate across nonempty chunks subtracts two bytes from the new contribution. Empty chunks preserve the preceding surrogate state. Overflow rejects before appending or forwarding the offending chunk, aborts upstream, and sends one error with no done event. Timeout and user cancellation retain priority. The CLI provider catches callback errors and settles before disconnecting, including synchronous disconnect and abort during the callback.

Unit coverage includes exact and one-byte-over ASCII, Arabic and emoji output, many small chunks, split surrogate pairs with intervening empty chunks, callback exceptions, HTTP reader cancellation and release, one usage attempt, fake CLI/group termination, and empty host temp folders. The reviewer ran the built-extension held-stream regression outside the sandbox; it passed, including upstream cancellation and disabled Accept. Existing input, SSE, native frame and CLI line caps remain unchanged. No new helper module or runtime fixture adjustment is needed.

Allowed checks completed on 2026-10-20 at 12:07 Africa/Cairo: targeted rewrite, CLI-provider and host tests passed 100 with 1 skipped; the full unit suite passed 413 with 2 skipped across 25 files. Lint, typecheck, full formatting check and production build passed. Lint initially found two unused mock parameters; those were removed and lint and typecheck passed again. Browser/runtime checks and final review remain with the reviewer.

Source: S01. Files: `src/background/rewrite.ts::runRewrite`, `bridge/host.mjs` text accumulation, relevant rewrite, CLI and bridge tests.

Stop total generated text above 1 MiB, even if every individual event is valid. Apply the limit to HTTP and native paths, including direct host callers. Abort the upstream reader or CLI group. Return an error, never a done event with truncated text. Ensure overflow thrown from a native callback rejects the active stream promise and disconnects its port.

Done: many small chunks cannot bypass the total limit; split Unicode remains valid; Accept is unavailable after overflow; an already-started failure counts once. Cancellation and timeout still clean up. Run rewrite, CLI-provider and bridge tests, then a built-extension held-stream regression that observes upstream cancellation.

## P01e. Bound HTTP error-body reads

Source: S01. Files: `src/background/providers/openai.ts`, `src/background/providers/anthropic.ts`, their tests; add one shared bounded-reader helper if both need it.

Replace unbounded `res.text()` on non-success responses with a reader that retains and decodes at most 8 KiB. Stop reading and cancel the remaining body at the limit. A chunk already delivered by the transport can be larger, so do not claim an exact cap on network bytes transferred. Keep the displayed detail at 300 characters and retain status codes, the Ollama hint and current network-error messages. Release readers after errors and cancellation.

Done: a mock endless error body is cancelled after bounded consumption; both providers show useful bounded diagnostics; multibyte text and an empty body work. Run both provider test files. The limit applies to downloads, not just the final string shown to the user.

## P02. Skip idle scheduling when disabled

Source: S02. Files: `src/content/idle.ts::createIdleFix` and its `onInput` and `tryRun` functions; `tests/e2e/popup.spec.ts` and `tests/e2e/extension.spec.ts`.

Check `deps.isEnabled()` before finding the editable field or creating/resetting an idle timer. Keep the final eligibility check before sending, and keep the Draft.js keyup fallback. Do not change manual button or shortcut behavior.

Done: ten typed characters while idle Fix is off or the site is blocked create zero new idle timers and zero requests. Disabling during an existing pause prevents its request. Re-enabling fixes the next eligible edit. Run the existing idle-off, blocking, adopted-answer and Draft.js browser regressions, plus P00a's timer counter.

## P03a. Run native version probes together

Source: G01. Files: `bridge/host.mjs::handlePing` and `readVersion`, `bridge/host.test.mjs`.

Run the three independent version checks concurrently. Keep the five-second per-command timeout and ten-second outer bridge deadline. Preserve all three diagnostic entries. An executable with an empty version string is still installed.

Done: three fake four-second commands return their versions within the outer deadline; a hanging command does not delay completed peers beyond that deadline; every fake command receives only `--version`. Run host tests and the offline ping benchmark. Do not run real rewrite CLIs.

## P03b. Gate automatic bridge checks by provider

Source: G01. Files: `src/popup/useBridge.ts`, its callers in `src/popup/App.tsx`, `src/options/sections.tsx`, `src/setup/App.tsx`; relevant options and toolbar browser tests.

Start an automatic check only when the selected provider is a CLI. Switching API to CLI starts a check; switching away makes an obsolete result unable to replace current UI state. Keep an explicit diagnostics action available to API users. Preserve the current install guidance and layout.

Done: opening options, setup and the toolbar with an API provider starts zero automatic native connections. CLI opens still show health, and explicit diagnostics still run. Exercise provider changes while a fake ping is held. Check light/dark mode and a narrow toolbar so status changes do not move controls incorrectly.

## P03c. Share and cache bridge health results

Source: G01. Files: `src/entrypoints/background.ts` bridge-status handler, `src/core/messages.ts`, `src/options/chrome.ts::bridgeStatus`, `src/popup/useBridge.ts`, bridge-provider and entrypoint tests.

Own health state in the background worker. Concurrent callers share one in-flight ping. Reuse a successful completed result for 30 seconds; do not cache failures. Check again bypasses a completed result but may share a ping already running. Worker restart clears this memory-only cache. Store no drafts, keys or provider settings in it.

Done: concurrent callers open one native port; immediate repeats reuse success; expiry, failure and restart retry; Check again obtains a fresh result after completion. Verify each caller leaves its loading state on failure. Run CLI-provider and entrypoint tests and the provider-change browser checks from P03b.

## P04. Debounce selection geometry

Source: G06. Files: `src/content/button.ts::createButton` and `selectionCaret`, `src/content/caret.ts`, selection cases in `tests/e2e/popup.spec.ts`.

Before the existing 150 ms debounce, check only eligibility and whether the selection is nonempty. Hide immediately on collapse or lost eligibility. Measure caret geometry only after the selection settles. Re-read the current selection then; do not retain an old range or mirror.

Done: 100 synthetic selection events create one settled geometry pass and no pre-debounce mirror layout reads. Collapse hides immediately. Forward/backward textarea selection, rich selection, scrolling, blocked sites, dialogs and popup transitions keep working. Run the selection and modal browser cases and P00a's isolated-world geometry counter.

## P05. Reuse completed result analysis

Source: G05. Files: `src/content/ui/Popup.tsx::Body`, `src/content/popupState.ts::popupNotes`, `src/core/diff.ts`, `src/core/tokens.ts`, existing popup-state and browser tests.

Cache completed diffs lazily by exact input/result within the current popup lifetime. Final-only viewing must not compute a diff. Cache static protected-token analysis separately from Accept failure/copy warnings. Invalidate on input/result replacement, retry and choice changes as needed. Keep existing whole-delete/whole-add fallback and multilingual output. Do not introduce a global draft cache or a new diff engine.

Read `src/content/idle.ts::record` too. Its initial marker count already computes once per completed result. Preserve that behavior; measuring its first diff belongs in P00a/P12, and does not justify a global cache between fields and popups.

Done: reopening Changes three times for the same 1,500-word replacement computes its diff once, after first opening Changes. Final stays lazy. Copy and view changes do not repeat token scans. A later failed Accept or copy still updates its warning. Run popup-state tests, completed-view and cached-choice browser tests, and P00a's repeated-view trace. The first pathological diff remains a separate measurement question below.

## P06. Cancel abandoned connection tests

Source: S03. Files: `src/popup/useTest.ts`, `src/options/chrome.ts::testConnection`, `src/core/messages.ts`, `src/entrypoints/background.ts`, `src/background/rewrite.ts::testConnection`, and options/setup/toolbar tests.

Use an extension-page-owned test port and an AbortSignal. Page close/unmount or provider change disconnects that test. A new test replaces only its owner's previous test. Keep save-before-test behavior, run-generation checks and current timeout semantics. Do not change manual rewrite ports or popup adoption of idle requests.

Done: closing an owner cancels a held mock HTTP body and stops a fake native child. Provider changes cancel the old test. Two independent extension pages do not cancel each other's tests. Reopening cannot restore an old result. Started tests count once; cancellation before start does not create an attempt. Cover all three callers and failure to save, using existing rewrite/entrypoint tests and the built extension.

## P07. Coalesce marker work

Source: G02. Files: `src/content/idle.ts::renderMarks`, `reposition` and `markSpot`, `src/content/ui/root.ts`, idle marker cases in `tests/e2e/popup.spec.ts`.

Combine scroll/resize/typing bursts into one pending position pass. Read each rich field's text at most once per periodic pass. Skip Preact rendering when marker position, status, label and stale state are unchanged. Keep the 250 ms movement fallback and periodic text checking. Do not make geometry or modal mounting depend only on input/focus events.

Done: unchanged ticks do not render again; event bursts share work; script-only text edits still mark results stale; CSS-only movement is followed within the existing 300 ms browser check. Scroll, resize, dialogs, border/scrollbar changes, blocking, spinner/error states and detached-editor cleanup pass. Compare a large rich editor and several markers against P00a. Do not claim battery savings from small-field script counts.

## P08a. Prove hidden document state in a browser

Source: G03's missing proof. Files: a visibility fixture under `tests/e2e/` or `bench/runtime/`, existing extension launch setup.

Establish a browser scenario that asserts `document.hidden === true` and `document.visibilityState === 'hidden'` in the actual tested document, then verifies the visible transition. Use a headed browser or supported visibility control. Switching focus alone is insufficient: the review's two-tab and minimized-window probes both still reported visible.

Done: repeated runs demonstrate real hidden/visible transitions for the top document and relevant editor frame. Keep this fixture usable by P08b. If the available browser cannot produce that state, mark this task blocked with the exact attempted method and observed values. Continue independent tasks; do not mark P08b complete using a skipped test or focus-only substitute.

## P08b. Defer new idle requests while hidden

Source: G03. Files: `src/content/idle.ts::tryRun` and visibility handling, the proven fixture from P08a, idle/usage browser cases.

Prevent new automatic requests while hidden. On return, recheck current focus, field eligibility, current text, elapsed typing pause, settings and blocked ancestors. Start at most one currently eligible request. Do not store a queued draft or restart the full delay when the pause already elapsed. Keep already-started requests running. Manual requests retain their current behavior. Pause marker polling while hidden and recheck text/position on return.

Done: the fixture first proves hidden state, then observes zero new automatic starts. Return starts one eligible request without duplicates or stale text. Disabled or blocked fields remain quiet, including editor frames. A deferred request counts only when it starts; an existing attempt keeps its count. Re-run the idle-off, adopted-request and movement checks from P02 and P07.

## P09. Stop posting unused idle chunks

Source: G07. Files: `src/background/rewrite.ts::runRewrite`, `src/entrypoints/background.ts` request dispatch, `src/content/idle.ts::readOutcome`, rewrite and browser tests.

Use the existing `trigger: 'idle'` to suppress preview chunk posts at the worker-to-content boundary. Continue accumulating, bounding and cleaning the provider output. Deliver the same done/error messages. Manual streaming remains unchanged. An open popup borrowing an idle promise still receives its completed result.

Done: a fake 1,000-chunk idle stream posts zero chunks and one final result; its manual equivalent still previews text. Final cleanup, overflow, error, cancel, retry and borrowed-popup behavior are unchanged. Run rewrite unit tests, existing idle-adoption browser cases and P00a's message counter.

## P10. Filter and order sanitized settings updates

Source: G08 and S04. Files: `src/entrypoints/background.ts` storage listener/page-settings handler, `src/core/messages.ts::PageSettings`, `src/entrypoints/content.ts::refresh`, `src/background/entrypoint.test.ts`, built-extension privacy/settings cases.

Compare normalized old/new projections of `blocklist`, `idleFix` and `defaultMode` before querying tabs. Skip irrelevant saves. For relevant changes, read one current sanitized snapshot and send it to all frames. Keep the initial page-settings request. Serialize or version asynchronous updates so neither old broadcasts nor a late initial read can overwrite newer state. Do not cache full settings for provider execution.

Done: model/key/effort/temperature-only changes produce zero page notifications and rereads. Relevant changes update all frames without one settings request per frame. Rapid block/unblock changes finish at the latest state. Content scripts still cannot read keys or receive full storage events. Run entrypoint tests and the actual isolated-world privacy and blocked-frame browser regressions.

## P12. Measure the request lifecycle

Source: S05 and the owner's Luna/Sol speed questions. Files: `bench/runtime/`, the existing model bench tooling and `bench/README.md`; production files only if a testable timing boundary cannot be observed externally.

Add an offline lifecycle report that separates request acceptance and usage-save time, native/CLI startup, first model text, model stop/ready, UI-ready time and child exit. Use controlled fake delays to prove the report distinguishes these phases. Include the production Codex arguments and fresh-cache versus cache-refresh paths from P11. Keep measurement code in the harness where possible. Add no telemetry or draft logging to normal use.

Done: a fake CLI that emits stop and then stays alive reports ready before exit; a delayed usage save and a delayed first chunk appear in the right phases; local reports use Cairo timestamps and retain raw durations. The report explains which delay a future optimization would address. It does not change the model, prompt, effort, idle delay or subscription route.

Live Luna/Sol runs are optional, require an explicit run budget and use synthetic inputs only. Prepare an exact command and call count when proposing that experiment. Do not make live calls part of CI or silently rerun them to obtain a favorable result. Existing P11 measurements already prove token reduction and do not prove a general speedup.

## P13. Verify the release candidate

Owner: orchestrator. Files: this plan, performance evidence/results, release documentation when a release version is later authorized.

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npx playwright test`. Record counts and skips from the actual run. Run `npm audit` and `npm audit --omit=dev` and review any findings.
2. Run `npm run bench:runtime` after P00a adds it. Compare baseline and candidate with the same fixtures, repetition counts and environments. Check work-count targets and retained work after repeated open/close cycles. Record slower-hardware gaps without inventing timing guarantees.
3. Verify per-model usage, cached answers, blocked ancestors/frames, trusted storage, rapid settings changes, adopted idle requests, safe rich-editor Accept, Undo and Backspace. Use mocks, fake CLIs and the built extension.
4. Push the candidate after the required rebase. Verify the normal CI run. Run `gh workflow run platforms.yml --ref main` and check that its tested commit matches the candidate; record macOS, Windows and Node 22 results separately.
5. Run `npm run pack`, extract the zip, and load the extracted artifact in a fresh profile. Configure the local mock with a fake key and reply `This is a test sentence`. Run Test connection, rewrite `this are a test sentence`, and Accept. The field must hold `This is a test sentence`. Backspace must remove the final `e` without an error; Undo must restore it, and undoing Accept must restore the original draft. Repeat in a plain field and supported rich-editor fixtures. Verify blocked embedded editors send zero requests and an unblocked editor sends one. Check Usage reflects those actual starts.
6. Record evidence and remaining limits in this plan. Stop test servers and browsers, remove only task-owned temporary files, and clean up merged task branches/worktrees.

Done: the exact candidate passes the applicable checks and has a measured before/after report, with no unexplained release blocker. No release tag, version bump or publication happens until the owner requests release. If an owner-only check remains, give the exact provider/model, fixed text, page, steps and expected result. Do not ask for unspecified "manual provider checks."

## Conditional experiments outside the task queue

These are not permission to implement extra features:

| Experiment                                     | When it is worth considering                                                     | Required evidence before adding an implementation task                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch manual stream previews                   | P00a/P12 show preview rendering dominates local time                             | Measured render/message reduction; final results bypass queued frames; retry, mode switch, close/reopen and old request generations cannot leak previews |
| Limit overlapping idle requests                | After P08b, measured slow idle requests overlap across fields, frames and tabs   | Choose browser-wide or per-frame scope and manual priority from evidence; show any waiting request is revalidated before starting                        |
| Bound the first pathological diff more tightly | P05 removes repeats but its first diff still exceeds an established UI budget    | Measure the existing jsdiff timeout/abort fallback before considering a worker or virtualization                                                         |
| Further Luna/Sol request-speed changes         | P12 identifies a specific bottleneck and a bounded live comparison is authorized | Compare ready time, input/cached/reasoning counts and quality on the same inputs; retain long outliers and rejected hypotheses                           |

No resident rewrite process, cross-site draft cache, framework rewrite, iframe removal, shorter rich-editor settlement waits, universal worker settings cache, or model/default change is planned. The [review decisions](../audits/performance-1.1.0.md#ideas-not-worth-including-now) explain the exclusions.

## Completion log

- P11: committed as `227afbc` and pushed before this plan was created. Full checks and measured limitations are in [its task record](codex-context.md).
- Plan preparation: accepted G01-G03 and G05-G08 map to tasks above. G04 is a conditional experiment. S01-S06 are covered. No additional production implementation started while converting the review.

- P00a: portable runtime tooling and 15 offline scenarios are implemented. The reviewer fixed a warm rich-editor fixture and added a macOS sandbox preflight after delegate Chrome crashes. Native mocking now starts in an isolated copy of the built worker. Unit tests passed 310 with 2 skipped, browser tests passed 136, and fixture/preflight checks passed 4. Two successful smoke runs matched coverage and exact request/message/decoding counts with identical source/build hashes. The [full baseline](../../bench/results/runtime-full-202610200817580300-63158.json) passed all 300 samples across 15 scenarios. Four separate heap snapshots were retained and checked against their recorded sizes. SIGTERM stopped new work before any browser scenario started. Lint, typecheck, build, and formatting passed. Earlier failed reports are retained outside the checkout. See the [verification record](../../bench/runtime/REPORT.md). No production optimization or version change is included.

- P00b: CI reuses its explicit build for Playwright. The standalone `test:e2e` script still builds. Browser coverage and dependency versions are unchanged. All 136 browser tests passed after a fresh local build. Formatting and the workflow diff passed review. The [first remote CI run](https://github.com/ashahinL/localpolish/actions/runs/39374910726) passed all gates and uploaded the runtime artifacts.

- P01a: complete in this commit. Raw input over 256 KiB UTF-8 is rejected before an attempt or provider work. The native prompt cap allows the existing 15-byte wrapper. The reviewer tightened the multilingual cases to exact adjacent byte boundaries and removed a constant-only test. Lint, typecheck, 331 unit tests with 2 skipped, formatting, build, 26 built-extension tests, and 30 runtime smoke samples passed. Grok suggested no new reusable skill; the reviewer agrees that the existing limit-test workflow covers this work.

- P01b initial handoff: implemented on `main`; the reviewer verification is recorded below. Tests cover native split headers, coalesced frames, UTF-8, exact 8 MiB payloads, header-only rejection before allocation, malformed JSON, and actual copy work at 1/2/4 MiB. Host tests use fake executables, private homes/temp folders, bounded producers with backpressure, exact-cap lines, overflow, CR/LF/EOF, final-event priority, active decoder failures, and resistant descendants. Native runtime copy metrics now include actual `Buffer.copy` work while preserving the historical concat metric. Allowed checks passed: `npm test -- bridge/lib.test.mjs bridge/host.test.mjs` (68 passed, 1 skipped), `npm run lint`, `npm run typecheck`, `npm test` (25 files, 351 passed, 2 skipped), `npx prettier --check .`, and `npm run build`. The measured native byte-copy totals for 1/2/4 MiB payloads were 1,048,580 / 2,097,156 / 4,194,308, including headers; concat returned-byte work was zero. Fake-process cleanup and empty host-temp folders passed, including resistant descendants. Test-created processes and directories were cleaned up. Guard skills and final review were skipped as dispatched. No git add, commit, push, release, version, provider, default, prompt or fleet changes. Reusable skill suggestion: none; this follows the existing bounded-stream testing workflow. Browser, HTTP/listening and runtime checks are reserved for the reviewer outside this sandbox. No other task status changed.

- P01b reviewer verification: lint, typecheck, 352 unit tests with 2 skipped, formatting, build, and all 15 runtime smoke scenarios with 30 samples passed. The [native copy experiment](../../bench/results/p01b-native-copy.json) measured 1,048,580 / 2,097,156 / 4,194,308 copied bytes for 1/2/4 MiB JSON payloads in 1 KiB fragments, including headers. The roughly 2 MiB benchmark frame copied 2,097,191 bytes, compared with 2,150,628,391 concat bytes in the original baseline. These are copy-work measurements, not model-latency claims. Cleanup tests include resistant descendants, overflow, malformed input, and one terminal reply after coalesced failures. Sol suggested no new skill; the reviewer agrees. P01a also passed [remote CI](https://github.com/ashahinL/localpolish/actions/runs/39395191716).


- P01c initial handoff: the reviewer verification is recorded below. Changed `src/core/limits.ts`, `src/background/sse.ts` and its tests, both API-provider test files, `bench/runtime/core.mjs`, `bench/runtime/fixtures.mjs`, `README.md`, `bench/README.md`, and this plan. Allowed checks passed: targeted tests 62; full suite 383 passed with 2 skipped across 25 files; lint, typecheck, formatting and build. The benchmark now instruments actual LF searches and UTF-8 encoding for bounded 1/2/4 MiB streams and retains an oversized-line rejection probe. Measurements, browser/socket checks, final review and commit are left to the reviewer outside the sandbox. No Chrome, Playwright, runtime harness, listening server or real provider/CLI was started. No guard skills, final review or git add/commit/push was run. No task-owned server, browser, worktree or temporary directory needs cleanup; the ignored production build remains in `dist`. No version, model, default, prompt, fleet or other task status changed. Reusable skill suggestion: none; the existing implementation and bounded-stream test workflow covers this work.

- P01c reviewer verification: all 383 unit tests passed with 2 skipped; lint, typecheck, formatting, build, four HTTP/preflight fixture checks, and 30 runtime smoke samples passed. The [SSE work record](../../bench/results/p01c-sse-work.json) confirms linear LF search/UTF-8 encoding work for bounded 1/2/4 MiB blocks, exact decoded events, oversized single-line rejection, upstream cancellation, and reader release. Fixture sizes now include a shared final EOF event; the old baseline is kept unchanged. Sol suggested no new skill; the reviewer agrees. P01b passed [remote CI](https://github.com/ashahinL/localpolish/actions/runs/39396456173).

- P01d initial handoff: implemented, pending reviewer browser/runtime and cleanup verification, review, and commit. Changed the browser and host limits, rewrite pipeline, CLI callback error handling, their unit tests, the built-extension held-stream regression, README, and this plan. Targeted tests passed 100 with 1 skipped; all 25 unit files passed, 413 tests with 2 skipped. Lint, typecheck, formatting and build passed. Incremental UTF-8 accounting preserves split surrogate pairs across empty chunks without encoding the growing output. Overflow aborts upstream and reports one error with no done or offending chunk. Fake HTTP cancellation/reader release, synchronous native disconnect, CLI/group termination and empty host-temp assertions passed. The sandbox denied a final process-list check with `operation not permitted`; it was not retried, so independent process cleanup verification remains with the reviewer. No Chrome, Playwright, runtime benchmark, listening server or real provider/CLI was started. Guard skills, final review and git add/commit/push were skipped as dispatched. P01c parent bookkeeping is preserved. No version, model, default, prompt, fleet or other task status changed. Runtime fixtures and results remain unchanged. Reusable skill suggestion: none; existing implementation and bounded-stream test workflows cover this work.

- P01d reviewer verification: lint, typecheck, 413 unit tests with 2 skipped, formatting, build, four benchmark-fixture checks, all 27 built-extension tests, and 30 runtime smoke samples passed. The initial new browser case used an empty field; adding its missing synthetic draft made it exercise the request. No production change was needed after review. HTTP cancellation and reader release, one accepted attempt, split Unicode, fake CLI process-group termination and temp cleanup passed. No task-owned browser or server remains. clean-code-guard: clean. Test/docs guards and manual comment review passed; Comment Sicko is unavailable in this environment. Sol suggested no reusable skill; the reviewer agrees. P01c passed [remote CI](https://github.com/ashahinL/localpolish/actions/runs/39397647004).
