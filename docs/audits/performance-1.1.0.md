# Performance review for the release after 1.1.0

Date: 20 October 2026, Cairo time.
Baseline: LocalPolish 1.1.0, source commit `3638cb03036bb675a8923a99dd715146a66b9dc1`. The product code at this commit is the code tagged `v1.1.0`; the later commit records publication checks.
Status: review complete and converted into the [performance release plan](../plans/performance.md). P11 is implemented, verified and pushed. The remaining implementation tasks have not started. No release number has been chosen.

The owner asked for a deep Grok 4.7 review at **xhigh for this run only**, followed by a check of every proposal and an independent sweep. That sequence is complete. Fleet defaults are unchanged.

Read this report for the decisions. The [original Grok report](performance-1.1.0-grok.md) is preserved separately. Its claims are proposals until accepted below. The [evidence file](performance-1.1.0-evidence.json) contains the measured results, probe source snapshots, and local artifact paths.

## What to do first

The strongest measured problems are repeated large diffs, selection geometry before its debounce, unnecessary native-host checks, and wasted work after a connection-test popup closes. Fragmented large messages also expose a cost that the normal-stream benchmarks missed.

Do not promise a percentage improvement in rewrite speed. The local checks isolate extension work. They do not measure current model response time, battery drain, or Windows performance.

| Finding | Evidence in this review | Decision |
| --- | --- | --- |
| Repeated completed diff | A 1,500-word full replacement used 200.8–201.7 ms of browser script time each time Changes was reopened. There was one provider request. | Cache completed analysis without caching dynamic Accept warnings. |
| Selection geometry before debounce | 100 synthetic selection events caused 100 style reads and 100 geometry reads before the 150 ms debounce finished, plus one final measurement. | Move geometry behind the debounce. |
| Idle marker work | One rich marker caused 24 `innerText` reads and 12 geometry, style, and document modal queries in 3 seconds. No marker caused none of these reads. | Reduce repeat work while keeping movement and stale-text checks. |
| Bridge checks for API users | Opening options and the toolbar page each attempted one native connection despite an API provider being selected. | Gate automatic checks and share CLI health work. |
| Disabled idle fixing | Ten typed characters armed 20 idle timers with idle fixing off. No provider request started. | Check whether idle fixing is enabled before doing field work. |
| Abandoned connection test | A held mock response stayed open 500 ms after the toolbar page closed. | Give the test a cancellable lifetime. |
| Fragmented native input | A 2 MiB frame arriving in 1 KiB pieces caused 2,150,628,399 cumulative bytes to be copied by `Buffer.concat`. | Bound messages and fix repeated copying. |
| Irrelevant settings changes | Changing only the selected model caused four page-settings queries across a page and its three frames. | Send updates only when page-visible settings change. |

The marker numbers confirm repeated work, not a severe CPU problem for a small field. The instrumented small-field runs used roughly 3–4 ms of script time over 3 seconds. Geometry reads did not cause measured layout work in those quiet samples. Do not call every geometry read a forced layout.

## Decisions on Grok's eight proposals

### G01. Reduce and parallelize bridge probes

**Accept with corrections. Priority: high. Effort: small to medium.**

Confirmed in `src/popup/useBridge.ts:23`, `src/popup/App.tsx:27`, `src/setup/App.tsx:49`, and `src/options/sections.tsx:31`. Automatic checks happen even when the API status UI does not need them. `bridge/host.mjs:67` awaits three version commands in sequence. Each has a 5-second timeout at line 60, while `src/background/providers/cli.ts:16` gives the whole ping 10 seconds.

The fake-only host probe exercised the actual `host.mjs`. All three commands received only `--version`. Their starts were sequential, at 0, 490, and 993 ms relative to the first. Total time was 1.62 seconds, including fake CLI Node startup and a 150 ms delay per command. This is not a real CLI latency measurement.

Use this smaller design:

- Automatically check the bridge only for a CLI provider. An API user can still explicitly request bridge diagnostics in options.
- Run independent version probes together under the existing outer deadline. Do not lower the per-command timeout without evidence.
- Share an in-flight ping across callers. A short, successful-result cache can avoid repeated checks. Check again must bypass the completed cache.
- Keep diagnostics available for all three CLIs. Do not mistake an empty version string for a missing executable.

Grok proposed a 3-second version timeout but also expected a 4-second fake command to return its version. Those conditions conflict. Keep the existing 5-second version timeout initially and test three 4-second probes in parallel under the 10-second outer deadline.

Done means API opens start zero automatic hosts, concurrent CLI checks share one host, slow independent versions fit the deadline, and Check again returns fresh status. Verify provider changes and worker restart too. No draft or key belongs in the cache.

### G02. Reduce marker work without losing correctness

**Accept a narrower version. Priority: medium. Effort: medium.**

Confirmed in `src/content/idle.ts:69`, `:295`, `:328`, `:341`, `:360`, and `:416`, plus `src/content/ui/root.ts:9`. The 250 ms loop continues while a marker is off screen. A detached editor is dropped and the loop then stops; this cleanup already works.

Coalesce position work from scroll, resize, and bursts of typing. Read a field's text once per pass. Skip Preact rendering when the marker's position, status, label, and stale flag have not changed. Keep the 250 ms movement fallback initially. The existing browser test expects a CSS-moved composer to be followed within 300 ms.

Do not apply all of Grok's proposed caches:

- A page script can change editor text without an input event. Keep a periodic text check, or replace it with a tested invalidation method. Input-only invalidation is insufficient.
- CSS can change border or scrollbar geometry without an input or window resize. Do not cache those values indefinitely under only those two invalidation events.
- Modal placement affects whether the UI can be used. Do not replace current mount checks with a focus-only cache without modal regressions.

Pausing marker work while the document is truly hidden is reasonable. Recheck position and text on return. The hidden-state browser proof is still missing, as explained under G03.

Done means unchanged markers stop causing redundant renders, the rich field is read at most once per periodic pass, event bursts share position work, and CSS movement, programmatic edits, scrolling, dialogs, blocking, and detached-editor cleanup still work. Measure a large rich editor and several markers before claiming battery or large-page savings.

### G03. Defer new idle requests while a tab is hidden

**Accept the direction, with a required browser proof. Priority: medium. Effort: small.**

`src/content/idle.ts:108` checks focus within the document but never checks `document.hidden`. The 3-second timer therefore has no application-level visibility gate. This confirms the missing condition. It does not establish how often a real user pays for a hidden-tab request.

Do not start a new automatic rewrite while truly hidden. When the page becomes visible, recheck the current field, current text, elapsed pause, settings, and blocked ancestors. Do not replay a stale queued draft. Keep already-started requests running for this change. Manual requests retain their current behavior.

The headless probe kept both pages visible. A headed minimize probe also reported `document.hidden === false`, even after disabling Playwright's focus emulation. It sent one request, but that is not proof of a request from a hidden document. This proposal needs a browser case that first asserts the document is actually hidden.

Done means zero new automatic requests during that verified hidden state, one eligible request after return, no duplicates, and unchanged usage semantics. A started attempt still counts. A deferred attempt is counted only when it starts. Test visible editor frames and blocked ancestors.

### G04. Queue idle requests to allow only one per frame

**Do not include as proposed. Measure first. Effort if pursued: medium.**

The overlap is possible: `Slot.running` is per field in `src/content/idle.ts:113`, and the background accepts independent ports at `src/entrypoints/background.ts:132`. However, there is no measured resource problem or normal concurrency distribution in this review.

A per-frame queue adds waiting and stale-job handling while leaving other frames and tabs unlimited. It is not a browser-wide process limit. Grok's finish-driven queue must also recheck focus, eligibility, text, and whether the second field's pause has elapsed. Preserving instant manual requests makes this more than a simple running flag.

First measure overlapping slow idle requests across fields, frames, and tabs after visibility deferral. If a limit is justified, choose its scope and manual-request priority explicitly. Do not add a permanent queue solely because parallel requests exist.

### G05. Reuse completed diffs and token analysis

**Accept with corrections. Priority: high for repeated long diffs. Effort: medium.**

Confirmed in `src/content/ui/Popup.tsx:197`, `src/content/popupState.ts:146`, and `src/content/idle.ts:208`. The diff runs for the completed Changes view, not for each streaming chunk. Token notes also return early while streaming. Equality already has a fast path.

Independent Node measurements reproduced about 25–27 ms for a 1,200-word pair with every third word changed, and about 201 ms for a 1,500-word full replacement. In the actual built extension, reopening Changes three times used 200.8, 201.7, and 201.6 ms of script time. Final used 0.5–1.0 ms in those same cycles. The network request count stayed at one.

Cache the diff lazily by the exact input and completed result. Do not eagerly compute it when the user is viewing Final. Memoize protected-token analysis separately. Keep caches within the existing popup or field lifetime, and invalidate them on a new result or retry.

Do not freeze all `popupNotes` on done as Grok suggested. Accept can fail later. The warning depends on `acceptFailure`, `acceptCopied`, and the platform at `popupState.ts:167`. Those notes must remain current. Nor should this change retain an unlimited history of field drafts just to reuse analysis.

The first pathological diff still blocks the page for about 200 ms. Measure a smaller work budget after repeat caching. The existing jsdiff timeout is cooperative, not a hard real-time guarantee. Use its [documented abort behavior](https://github.com/kpdecker/jsdiff#readme) rather than introducing a new diff engine first.

Done means unchanged result/view/copy operations do not rerun the expensive analysis, Final stays lazy, dynamic Accept warnings still change, and normal diffs retain their output. Keep the current whole-delete/whole-add fallback. Test multilingual text and retry or mode changes.

### G06. Put selection geometry behind the debounce

**Accept. Priority: high. Effort: small.**

`src/content/button.ts:59` calls `wanted()` on every selection event before scheduling the debounce. `wanted()` reaches `fieldFocusCaret`, which appends a mirror and reads its layout in `src/content/caret.ts:50`.

The browser probe confirmed 100 style and geometry measurements for 100 synthetic events before the debounce, followed by one more measurement after it. The burst took about 30 ms in one sample. That is a controlled event burst, not a claim about a person's drag speed.

On each event, check only eligibility and whether a nonempty selection exists. Hide immediately if it does not. Measure geometry only after the existing 150 ms pause. Keep backward selection, rich selection, scroll hiding, popup state, and blocklist handling.

Done means one geometry pass per settled selection burst and immediate hiding on collapse. Do not remove rich-editor support or reuse geometry after the selection changes.

### G07. Reduce streaming messages and paints

**Accept suppression of unused idle chunks. Measure before committing to manual rendering changes. Effort: small for suppression, medium for batching.**

`src/background/rewrite.ts:46` posts every chunk. `src/content/idle.ts:428` consumes only done and error. In a direct probe of the actual rewrite code, a fake 1,000-chunk stream produced 1,000 chunk posts plus done for both manual and idle requests. This measures callback counts, not IPC time.

Suppress idle chunk posts at the worker-to-page boundary. Continue accumulating output for cleanup and deliver the same done or error. An open popup borrowing the idle promise still receives its completed answer.

For manual streaming, first profile real render and message counts with controlled bursts and slow streams. If painting dominates, combine text updates into at most one render per animation frame. The final full result must bypass a delayed preview frame.

Grok's closed-session and phase checks are not enough on their own. A retry or mode change reuses the session and returns it to the streaming phase. Cancel queued callbacks on request replacement, close, error, and completion, or give them a request generation. Otherwise an old preview can enter a new request.

Done for idle suppression means zero chunk posts, unchanged final text, correct marker and borrowed-popup behavior, and working cancel/error paths. Manual batching requires evidence of a benefit plus rapid retry, mode-switch, close/reopen, hidden-page, and final-before-frame tests.

### G08. Include sanitized page settings in update messages

**Accept with the additional filtering in S04. Priority: medium. Effort: small to medium.**

Confirmed at `src/entrypoints/background.ts:104`, `:198`, and `src/entrypoints/content.ts:46`. Each settings update currently causes every content frame to ask again and reload settings.

Read once and send only `blocklist`, `idleFix`, and `defaultMode`. Keep the initial page-settings request. Keep full settings and API keys in trusted contexts.

Skip broadcasting when these three values did not change. Also prevent an older asynchronous refresh from overwriting newer settings. A fast sequence of block and unblock updates must end at the newest state. Do not add a stale full-settings cache to the rewrite path.

Done means irrelevant model or key edits cause zero page-settings broadcasts, relevant edits use one sanitized snapshot, all frames update, rapid changes preserve the newest state, and the content-world key-isolation test still passes.

## What the independent sweep added

### S01. Bound large inputs and outputs, and handle fragmentation efficiently

**Include. Priority: high for resource protection. Effort: medium.**

Grok checked ordinary small SSE events and noted `Buffer.subarray` in the native decoder. That misses how incomplete messages grow.

- `bridge/lib.mjs:43` concatenates the entire pending frame for each new fragment. A 2,097,199-byte frame in 1 KiB fragments caused 2,150,628,399 cumulative copied bytes and took 109 ms in the offline probe. With 64 KiB fragments it copied 36,634,671 bytes and took 2 ms. These are cumulative copies, not simultaneous memory use.
- `src/background/sse.ts:45` searches the growing buffer again when no newline arrives. A 2 MiB data line in 1 KiB fragments took 213 ms to drain, compared with 4 ms in 64 KiB fragments. It yielded a 2 MiB event at EOF. This was a malformed or oversized-stream stress case, not a typical model stream.
- `src/entrypoints/background.ts:64` checks that input is a string but has no application size limit. `src/background/rewrite.ts:30` accumulates the full answer without a total limit. The native decoder has no application frame limit. Error handling in both HTTP providers calls `res.text()` before slicing the displayed message to 300 characters, so that slice does not bound the download.

Choose documented input, output, frame, event, and error-body limits. Reject oversized work with a clear error, and stop the reader or child process. Never silently truncate a draft or present a partial answer as acceptable. Replace repeated whole-prefix copying with a bounded chunk or frame buffer. Avoid rescanning a whole incomplete SSE line on every fragment.

The existing 60-second timeout does not bound bytes received in that time. The 100,000-character native output chunk size only bounds individual outgoing messages, not total output. Anthropic's 4,096-token setting is provider-specific and does not cover the other paths.

Done means fragmented and oversized fixtures finish within a defined byte and work budget, total output and diagnostic bodies stay bounded, and cancellation releases buffers and processes. Valid split UTF-8, CRLF, surrogate pairs, and normal large drafts still work. Reject input before starting an attempt; an output-limit failure after a start still counts once.

### S02. Stop idle work early when the feature is off

**Include. Priority: medium. Effort: very small.**

`src/content/idle.ts:69` finds an editable, checks eligibility, creates a slot, and resets a timer before the enabled check at `:111`. Both input and keyup take this path. With idle fixing disabled, ten characters still armed 20 timers. No provider call occurred, so this is unnecessary local work rather than unintended data transmission.

Check the idle-enabled predicate before field discovery and scheduling. Keep the final enabled check before send to cover settings changes during a pause. Keep the keyup fallback needed by Draft.js. Do not disable the manual button or shortcut.

Done means typing while idle fixing is off or the site is blocked schedules zero new idle timers. Re-enabling works on the next eligible edit. Existing pending work cannot bypass a later disable or block.

### S03. Cancel a connection test when its owner goes away

**Include. Priority: high for avoiding wasted provider work. Effort: medium.**

`src/popup/useTest.ts:17` uses `runId` to ignore obsolete results. It does not cancel the request. `src/options/chrome.ts:46` sends a one-shot message, and `src/background/rewrite.ts:81` creates a controller owned by the background test. There is no cancellation message or disconnect path tied to the requesting page.

In the built extension, a local mock sent the first chunk and held the response open. The toolbar page closed. The response was still open 500 ms later. The probe then released it to clean up. The code permits that work to continue until completion or the 45-second test timeout.

Use a cancellable test session, scoped to the requesting extension page. Closing that page or changing the provider cancels its test. A new test must not cancel another page's independent test. Keep the already-started usage count. Do not change the lifetime of manual rewrite ports or idle results that a popup borrows.

Done means the held API response closes after its owner closes, a fake native child is stopped, provider changes cancel only the old test, and reopening does not restore an obsolete result. Test options, setup, and toolbar callers.

### S04. Avoid updates for settings the page never receives

**Include with G08. Priority: medium. Effort: small.**

G08 removes the second request per frame but still broadcasts every full-settings save. Most provider, model, effort, key, and temperature changes do not change the three page-visible settings.

The browser probe changed only the selected API model. A page and three child frames made four fresh page-settings queries. No page-visible value had changed. The same fan-out applies across open tabs.

Compare the normalized old and new page-settings projection before querying tabs. Skip irrelevant saves entirely. For a relevant change, use G08's sanitized snapshot and preserve ordering. Do not broadcast the full storage change object.

Done means a model-only or key-only save produces zero page notifications or rereads, while changing the blocklist, idle flag, or default mode reaches all frames promptly and safely.

### S05. Establish performance measurements that match the product

**Include first. Priority: high as a release prerequisite. Effort: medium.**

`bench/bench.mjs:82` records completion at CLI close. Production `bridge/host.mjs:232` sends done at the model's stop event and then cleans up the child. The old benchmark is useful for model comparisons but is not the user's time-to-ready. `bench/probe.mjs` also has historical final-event and configuration variants. The benchmark notes acknowledge these differences.

Create a separate, offline runtime benchmark before changing the hot code. Measure the built extension with synthetic drafts, a local mock, and fake native CLIs. Record first preview, ready result, repeated view changes, idle work, request and native-process counts, cancellation, fragmentation, and heap retention after repeated open/close cycles. Use small, large, multilingual, and pathological inputs.

Separate warm and cold runs. Record environment, versions, input sizes, repetitions, raw results, and medians or percentiles with a stated method. Use work-count limits for stable regression checks. Establish timing budgets from repeated baseline runs, including slower hardware, rather than making this M4's timings universal gates.

The review probes and results in the evidence file are a starting point. They are one-off source snapshots tied to this checkout, not a portable CI benchmark. Their hard-coded local paths must be removed when promoting them into project tooling.

There is also a small CI-only saving: `.github/workflows/test.yml:29` builds, then `npm run test:e2e` builds again through `package.json:15`. Build once in CI and run the browser suite against that build. Keep a standalone command that still builds before testing. Do not remove real browser coverage to save time. The isolated content world also explains why replacing all real extension waits with a page's fake clock needs proof first.

Done means before/after reports measure the actual ready event, can run without paid calls, and are stored as CI artifacts. Keep model-quality benchmarks and runtime benchmarks clearly separate.

### S06. Follow-up: inspect and reduce Codex's inherited context

Update on 20 October 2026: P11 now removes the inherited context and unused tools when fresh model metadata is available. Live Luna and Sol fragment requests fell to 781 input tokens. See the [implementation, fallback behavior and quality results](../plans/codex-context.md). The investigation below records the earlier findings.

**Include as a request-speed investigation. Priority: high. Effort: medium.**

The owner's follow-up asked whether Luna and Sol use zero reasoning tokens but start with about 13,000 input tokens. Recounting the October 17 raw logs confirms the large historical input, but not the whole reasoning claim:

| Saved setup | Runs | Mean input tokens | Reported reasoning |
| --- | --- | --- | --- |
| Luna, none, before base-prompt replacement | 20 | 13,041 | Zero in all 20. |
| GPT-6.1 Sol, low, before replacement | 20 | 13,733 | Zero in 16. The other four used 17, 54, 27, and 33 tokens. |
| Luna, none, low, and medium, after replacement | 63, 21 per effort | 9,378 | Zero in all 63. |

Sources: `bench/results/2026-10-17-win-round0.jsonl`, `2026-10-17-win-rounds1-3.jsonl`, and `2026-10-17-mac-luna-effort.jsonl`. These logs do not establish Sol's behavior at medium or none. GPT-6.1 Sol does not support none in the [official reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning). Zero reported reasoning on simple requests does not mean a supported effort always produces zero reasoning.

These are input-context tokens. Codex adds coding-agent context around the writing task. The separate six-pair probe in `2026-10-17-mac-probe.jsonl` showed about 12,857 input tokens with the default base prompt and 9,368 with our replacement. The roughly 3,489-token reduction is already reflected in `bridge/host.mjs:123` and `bridge/lib.mjs:163`. Calling the whole 13k the built-in base prompt was too broad.

An offline `codex debug prompt-input` check with CLI 0.162.1 used an auth-free temporary home, a minimal environment, a local model catalog, the project's disabled-feature arguments, and its actual Fix instruction. For both selected models it still rendered a 13,951-character skill-catalog block, permission and collaboration instructions, a 2,400-character agent-role block, a 271-character agent-mode block, and environment information. Our Fix instruction is 391 characters. These character counts are not token counts. The debug command omits separate base instructions and tool schemas, so it does not provide a complete token breakdown of the wire request.

Why the extra context exists: the bridge starts a general coding agent for each rewrite. Replacing its base instruction does not necessarily remove its other generated context. The exact historical 13k request bodies were not saved. Current offline rendering identifies real extra context, but does not prove the precise composition of those older requests or a fresh current input-token total.

Inspect the actual `exec` request against a local capture endpoint before selecting a removal method. Test supported controls for skill discovery, agent instructions, and unused tool definitions in isolation. A diagnostic attempt to disable the 32 listed skills and multi-agent support did not remove their blocks from the debug rendering; those flags are not yet a verified fix. Do not change the user's global skills or coding fleet. Keep any reduced configuration confined to LocalPolish's bridge process.

Also separate cached from uncached input. One saved Luna request reported 13,040 input tokens with 12,032 cached. Cached tokens are part of that input total, not additional tokens. Do not infer request latency directly from the total. See the [official cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching).

Done means a captured request contains only the context required for rewriting, no unintended global skill or agent catalog, and unchanged tool restrictions and text quality. Measure actual input tokens and ready-result latency on the same inputs before claiming a speedup. No new inference calls were made for this confirmation. Full recounts and debug summaries are in the evidence file under `codexInputFollowUp`.

## Original review task groups

These are the original review groups. The [execution plan](../plans/performance.md) splits P00, P01, P03 and P08 into smaller tasks, adds request-lifecycle measurement and candidate verification, and defines the current dependencies and done checks. Use that plan for implementation. P11 is already committed and pushed.

| Order | Work | Required proof |
| --- | --- | --- |
| P00 | S05: portable offline runtime baseline and performance budgets | Reproduce the current work counts and ready-event timings. Preserve raw results. |
| P11 | S06: inspect and reduce Codex request context, added after the owner's token-count question | Capture the actual request, verify a LocalPolish-only reduction, then measure tokens, latency, and quality. |
| P01 | S01: resource limits and fragmented buffers | Bounded bytes and work, valid split text preserved, clean aborts, no silent truncation. |
| P02 | S02: early disabled-idle exit | Zero new idle timers when off or blocked; manual tools still work. |
| P03 | G01: provider-gated, shared, parallel health checks | Zero automatic API probes; one shared CLI probe; force refresh and deadlines work. |
| P04 | G06: selection measurement after debounce | One geometry pass after a burst; immediate hide on collapse. |
| P05 | G05: lazy result-analysis reuse | Reopening Changes avoids the repeated 201 ms work; Accept warnings remain live. |
| P06 | S03: connection-test cancellation | Closing or changing the owner stops its fake API or CLI test. |
| P07 | G02: cheaper marker updates | Preserve periodic CSS movement and script-edit detection while reducing reads and renders. |
| P08 | G03: hidden-page idle deferral | A test first proves true hidden state, then proves zero starts and correct resume. |
| P09 | G07: suppress unused idle chunks | Zero idle chunk posts, unchanged done/error and borrowed-popup behavior. |
| P10 | G08 plus S04: filtered, sanitized settings updates | No fan-out for irrelevant saves; relevant snapshots are current and key-free. |

Manual stream batching, a global idle scheduler, diff workers, and diff virtualization remain conditional experiments. They are not required implementation tasks until a measurement justifies them.

Across all tasks, keep idle fixing on by default. Preserve blocked ancestors, content-world storage isolation, exact usage semantics, cancellation, cached mode answers, safe rich-editor Accept, Undo, and Backspace. Do not add telemetry or persist draft text. Keep existing behavior and privacy regressions in the release gates.

## Ideas not worth including now

| Idea | Decision and reason |
| --- | --- |
| Resident bridge or persistent rewrite CLIs | Reject for this release. Host-only startup does not measure the cost of a warm CLI or retained model context. A permanent native connection can keep the extension worker alive, adding lifecycle and privacy costs. See the [Chrome worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). |
| Remove iframe injection | Reject. It would remove support for editors the product already supports. The 58,426-byte content bundle alone does not prove a startup problem. Grok's Node compile-time extrapolation is not a browser measurement. |
| Rewrite SSE, string concatenation, or the diff engine wholesale | Reject. Ordinary streams were cheap. S01 targets the demonstrated fragmented and oversized cases. G05 targets repeat analysis. |
| Split bundles or change the UI framework | Defer. The package is already small. Measure frame startup and retained heap before adding a loader or rewriting the UI. Development editor fixtures do not ship. |
| Start a provider before saving its usage count | Reject. It would break the tested cancellation/count boundary. Keep serialized durable counts. |
| Cache all settings in the worker | Reject as a shortcut. A stale provider or blocklist is not an acceptable trade for an unmeasured storage saving. Cache only diagnostics or a carefully invalidated sanitized page projection where justified. |
| Shorten rich-editor settlement waits | Reject. Those waits protect Slate and paste behavior. The existing 150 ms before paste and 50 ms after handling are not repeated idle work. |
| Change models, prompts, or idle delay based on old latency tables | Reject for this review. The October 17 results are historical, mostly Fix-mode quality tests. No current provider or Rephrase/Tone benchmark was run. |
| Add a cross-site draft or result cache | Reject. More retained draft history and difficult invalidation are not justified by these measurements. |
| Optimize blocklist parsing or usage-table sorting now | Defer. No representative bottleneck was demonstrated. Keep the simple code. Model-row growth can be measured with synthetic large storage before changing its schema. |

## Sweep coverage and limits

The independent sweep followed the complete runtime path and its supporting tooling:

| Area | Checked | Outcome |
| --- | --- | --- |
| All-frame boot and settings | Content entrypoint, host rules, background message handlers, initial reads, change propagation, trusted-storage boundary | G08 and S04. Do not weaken frame blocking or key isolation. |
| Typing, selection, and markers | Editable discovery, input/keyup fallbacks, idle requests, markers, caret mirrors, placement, modal root, clipboard, toast | G02, G03, G06, S02. Detached-marker cleanup works. |
| Manual rewrite UI | Controller/session lifetime, reducer/cache, streamed view, completed diff, notes, Accept and copy | G05 and G07. Existing Accept settlement and selection revalidation stay. |
| Providers and bridge | HTTP streaming, error bodies, timeouts, cancellation, native frame decoder, command parsing, process groups, wrappers/installers | G01, S01, S03. No new installer optimization justified. |
| Options, setup, toolbar, usage | Settings writes and locks, editing merge, health/test hooks, static UI, tooltip/timer cleanup, usage serialization and sorting | S03 and S04. No new recurring-loop finding in static UI or usage. |
| Build and dependencies | Manifest, shipped JS, eager imports, dependency roles, CSS animations, Node support and workflows | Measure startup before splitting. Duplicate CI build belongs to S05. |
| Tests and benchmark method | Editor and popup fixtures, actual extension fixture, mock API, bridge tests, old model benches and report calculations | Keep behavioral coverage; add runtime measurements instead of treating tests as performance evidence. |

Measurements used an Apple M4 Mac on macOS 26.7.1, Node 26.10.0, and Playwright Chromium 156.0.8078.4. DOM counters were installed in the extension's isolated world after startup. Instrumentation adds overhead. Synthetic event bursts and 2 MiB frames are stress cases. Small timing samples are not population percentiles.

The initial independent sweep did not measure real provider latency or token savings, real CLI version-command latency, battery/power use, slower hardware, Windows runtime performance, verified hidden-tab behavior, many-tab retained heap, sustained rich-editor scrolling, or live model chunk rates. The later [P11 comparison](../plans/codex-context.md) measured Luna/Sol input reduction and exploratory timings; it did not establish a general speedup. The remaining gaps affect priorities and acceptance tests; they do not turn code inspection into measurements.

No production code, settings defaults, dependency versions, bridge installation, user drafts, or fleet configuration were changed. Tests used fresh profiles, fake text, local mocks, and fake version CLIs. The full product test suite was not rerun for a documentation-only audit. Each implementation task must run its targeted checks and the release must run the full gates.

Grok's initial headless plan-mode run stopped at a command approval prompt. The executable review then completed its inspection without repository edits. Its cleanup removed the shared temporary directory, so the runner lost its files. The saved Grok session and measurements were recovered, and the final report was produced from that session. The original benchmark's ES-module parse error is recorded in the raw report; no whole-suite benchmark success is claimed.

Grok proposed no reusable skill. I agree. The next useful reusable item is the project benchmark in P00, rather than another agent workflow skill.
