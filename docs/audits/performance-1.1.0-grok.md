# Original Grok performance review

Grok 4.7, xhigh, 20 October 2026. This is the original report, kept as evidence. See [the checked review](performance-1.1.0.md) for accepted, corrected, and deferred proposals. The report below is not an implementation instruction.

LocalPolish 1.1.0 performance review, read-only, at `3638cb03036bb675a8923a99dd715146a66b9dc1`. No files were changed. The offline suite did not finish: `vm.Script` threw on an ES module chunk, so the host-startup and denser-diff numbers below come from a second command.

## 1. Executive summary

The expensive work is a real CLI process per rewrite, plus work the page repeats while a marker or selection is up. Model time still dominates a visible Fix. The next release can cut wasted process starts and repeated page work without a resident bridge.

Highest-value opportunities:

- **G01.** Every toolbar popup, the options page, and setup start a native host that versions Claude, Codex, and Grok one after another. Host startup alone was about 43 ms. Real `--version` time was not measured. Three 5-second command timeouts do not fit in the 10-second popup deadline.
- **G03.** A hidden tab can still start an idle Fix after the 3-second pause. That is a full bridge process and a usage count for a tab the user is not looking at.
- **G02.** While a marker is showing, scroll, keyup, and a 250 ms timer each re-read layout, and a rich editor’s text, then re-render. The timer has to stay: a test moves a field with CSS and expects the marker to follow within 300 ms.

Biggest unknowns, all unmeasured in a browser: cost of `innerText` and forced layout on a large editor, real CLI `--version` time, and how many stream chunks Claude or Grok emit per answer.

Normal Fix diffs are cheap. A 300-word text with a few edits took 0.2 ms. A 1,200-word text with every third word changed took 27.3 ms and 1,200 parts. Two long texts with no shared words hit the 200 ms diff cap and came back as one delete plus one insert. Streaming does not run that diff. Copy and the Changes view can run it again.

## 2. Proposals

### G01. Probe the bridge less often, and probe CLIs together

**Where:** `bridge/host.mjs` `handlePing` (lines 67–75) and `readVersion` (lines 51–65). `src/background/providers/cli.ts` `pingBridge` (lines 142–191, `PING_TIMEOUT_MS` line 16, timer line 154). Callers: `src/popup/useBridge.ts` lines 23–25, used unconditionally from `src/popup/App.tsx` line 27 and `src/setup/App.tsx` line 49. `src/options/sections.tsx` `BridgeSection` lines 31–33, always mounted from `src/options/App.tsx` line 31. `src/entrypoints/background.ts` lines 218–223 answer `bridge-status` with `pingBridge()`.

**Trigger and frequency:** Every toolbar popup mount, every options open, every setup open, and every Check again. Each call starts a new native host. `bridge/install.mjs` lines 68–69 show the wrapper `exec`s Node on `bridge/host.mjs` per connection. No in-memory cache.

**Costly work, from code:** `handlePing` `await`s `readVersion` for whichever of `claude`, `codex`, and `grok` are on `PATH`, in that order. Each `execFile --version` has a 5-second timeout. The popup gives up at 10 seconds and reports that the bridge did not respond. A slow trio can therefore fail the popup while the host is still working. `findOnPath` is not the cost.

**Measured:** Node plus `host.mjs`, then stdin closed, no CLI. Five runs, exit 0, empty stderr: 46.7, 43.6, 42.6, 42.3, 43.8 ms. Median 43.6 ms. Fake 80 ms sleeps, three in a row 243.7 ms, `Promise.all` 80.9 ms. That only shows the sequencing, not CLI time. `findOnPath` for three names across 80 missing directories: 0.71 ms per triple lookup, 20 times. This machine’s `PATH` has 25 entries. Real `--version` was not run.

**`connection()` does not need the probe for API providers.** `src/popup/summary.ts` lines 95–102 label Anthropic and OpenAI-compatible from the key and base URL. The popup still probes.

**Smallest change:** After settings load, skip `bridge-status` unless the provider is a CLI. In the host, start the version commands together, each with a timeout that fits under 10 seconds (3 seconds is enough room). Keep one successful pong in the service worker for about 30 seconds. Check again skips the cache. Do not cache failures for long. Options still lists all three CLIs, so that page still probes all three, in parallel.

**Benefit:** CLI popup opens wait for one host plus the slowest version command, instead of the sum. API popups do not start a host. A hung version command is less likely to be reported as a dead bridge.

**Risks:** A CLI installed or removed during the cache window looks stale until Check again or expiry. A shorter version timeout can show a blank version for a slow but healthy CLI. `readVersion` already treats a timeout as an empty string, and the UI shows a blank version rather than “not found”. Versions are not draft text. No key or draft is added to the pong.

**Effort:** small. **Priority:** high.

**Acceptance:** Count native-host processes for one API popup open (expect 0) and one CLI popup open (expect 1). On a stub that sleeps 4 seconds per `--version`, sequential ping hits the 10-second failure and parallel ping returns three versions. Check again ignores the cache. No real CLI.

### G02. Make marker following cheap, and keep the 250 ms fallback

**Where:** `src/content/idle.ts`. `FOLLOW_MS` line 30. Listeners lines 62–67. `onInput` lines 69–84 calls `reposition`. `renderMarks` lines 295–388. Interval line 341. `hideAll` lines 390–395. `fieldText` at lines 328 and 360. `markSpot` lines 416–426 (`getBoundingClientRect`, `getComputedStyle`). `src/content/editable.ts` `fieldText` lines 44–47 uses `innerText` for rich editors. `src/content/ui/root.ts` `mountPoint` lines 9–14 runs `querySelectorAll('dialog:modal')` from every `layer()` call.

**Trigger and frequency:** The interval starts when any marker is shown and stops when none are. Scroll (capture) and keyup/input also call `renderMarks` whenever any marker exists, including when the key landed in a different idle field. A quiet marker therefore ticks 4 times a second, and a scroll can call the same path once per scroll event.

**Costly work, from code, per completed rich-text marker per call:** two `innerText` reads (equal-to-fixed check, then stale check), one bounding rect, one computed style, scrollbar math, a Preact render, and a document-wide `dialog:modal` query. Busy markers skip the text reads and still do layout. Textareas use `.value`, which is cheap, but scroll still does layout, style, and Preact.

**Measured:** none of this DOM work. Node cannot lay out a page. This is a hypothesis until a browser profile.

**Why the timer exists:** `idle.ts` line 340. Sites move the composer with no scroll event. `tests/e2e/popup.spec.ts` lines 790–806 translate the textarea and `fastForward(300)`, then expect the marker to have moved 80 px. Lines 757–769 expect a scroll to hide the marker and a scroll back to show it.

**Smallest change:** Keep a 250 ms fallback so that test still passes. Coalesce scroll and resize to one animation frame. On those position updates, compare the last rect and skip Preact when top and left are unchanged. Do not call `fieldText` on a position-only update. On input, read the field text once and reuse it for the stale flag. Cache border and scrollbar width until input or resize. Re-check the dialog mount on `focusin`, not on every tick. Pause the interval while `document.hidden`, and run one `renderMarks` when the tab becomes visible.

**Benefit:** Scrolling or typing beside a visible marker does less layout and fewer rich-text reads. A background tab with a marker stops the 4 Hz loop. The marker still follows a CSS move within 300 ms and still hides when scrolled off screen.

**Risks:** Skipping `innerText` on scroll must not freeze a stale badge. The input path still refreshes stale state. Pausing while hidden must not leave a marker at the old corner after the user returns; the visibility handler does one pass. Blocked-frame checks stay in `isEnabled`. No draft is stored.

**Effort:** small to medium. **Priority:** high for the repeated path. The millisecond win is unmeasured.

**Acceptance:** On a large contenteditable with one marker, a performance trace during one second of scrolling shows one geometry pass per frame and no `innerText`. The two existing Playwright cases above still pass. A hidden tab does not keep the interval. Browser work is still required. This session did not run it.

### G03. Do not start a new idle Fix while the tab is hidden

**Where:** `src/content/idle.ts` `tryRun` lines 108–121. The 3-second timer is armed in `onInput` lines 77–83. Nothing reads `document.hidden` or `visibilitychange` anywhere under `src/`.

**Trigger:** Idle Fix is on by default (`src/core/settings.ts` line 44). The timer fires after a 3-second pause in a focused idle field of at least 4 words, even if the user has switched tabs. Chromium clamps background timers. That clamping was not measured here.

**Costly work:** `send` (lines 123–189) connects a port, and the background starts a native host and a CLI. `recordUsage` runs first (`src/background/rewrite.ts` lines 25–26), so the attempt counts. The full field text is posted (line 187).

**Measured:** host process floor about 43.6 ms before any CLI. Model time is seconds, from the 17 October bench notes, which are old and were not re-run.

**Smallest change:** At the start of `tryRun`, return when `document.hidden`. On `visibilitychange` to visible, if the pause already elapsed, the field is still eligible, and the text changed, call `tryRun`. Let an in-flight request finish.

**Benefit:** Switching away during the pause does not spawn a CLI or add a usage row. Coming back still fixes the field if it should be fixed.

**Risks:** The marker appears after the user returns, not before. A request that already started still finishes, so a hide mid-run still spends the model call. `document.hidden` follows the tab, including a hidden iframe document. A visible editor iframe in a visible tab still runs. Blocked ancestors still fail `isEnabled` first. Usage rules stay: a started attempt counts, an attempt that never starts does not.

**Effort:** small. **Priority:** high.

**Acceptance:** With the fake provider, type 4 or more words, hide the tab before 3 seconds, and assert zero requests. Show the tab again and assert one request and one usage row. A request started while visible still completes after hide. A blocked frame still sends zero.

### G04. One idle CLI at a time in each frame

**Where:** `src/content/idle.ts` `tryRun` lines 113–120 and `send` lines 123–132. Each field has its own `running` flag. `src/entrypoints/background.ts` `onConnect` lines 132–179 starts every port immediately. There is no cap.

**Trigger:** Focus field A, pause 3 seconds, then focus field B and pause again before A’s CLI exits. Two hosts. Slow models make this easier. The 17 October notes show multi-second runs. Those notes were not re-run.

**Costly work:** One Node host and one CLI per field. Manual popup rewrites use another port and must not wait behind idle.

**Measured:** no overlapping-process count. Code fact only.

**Smallest change:** In one content script, if any slot is in `send`, do not start another idle `send`. Remember the waiting field and start it from `finish` (lines 144–172). Show the busy mark when the request actually starts. `open` for a manual popup still cancels only that field’s idle slot and opens immediately.

**Benefit:** Tabbing through a form does not stack CLIs. Each field still gets a turn and its own usage count when its turn starts.

**Risks:** The second marker appears later. Do not cancel the running field. Do not queue a shortcut or button rewrite behind idle. `tests/e2e/popup.spec.ts` lines 772–787 pause between two fields and expect two markers. A fake clock that answers instantly still passes. A cap must not drop the second request.

**Effort:** small. **Priority:** medium. Do this after G03. Hidden tabs are the common extra process.

**Acceptance:** Two fields, first reply delayed, second pause while the first is in flight. Expect one provider request, then the second after the first finishes. Both usage rows exist. A shortcut during the first request still starts its own rewrite. One field’s behavior is unchanged.

### G05. Compute the finished-answer diff and token notes once

**Where:** `src/content/ui/Popup.tsx` `Body` lines 174–203, `wordDiff` at line 197. `src/content/popupState.ts` `popupNotes` lines 146–173, called from `Popup` line 81 on every render. `src/content/idle.ts` `record` lines 207–208. `src/core/diff.ts` `wordDiff` lines 5–22. The `diff` timeout is checked between edit-length iterations (`node_modules/diff/libesm/diff/base.js` lines 38–39 and 131).

**Trigger:** Once when an idle result is recorded. Again when the popup renders Changes. Again on every later popup render of that view: Copy (the 1.5-second timer renders twice), view toggle, tab switch that keeps the same answer. Streaming does not call it. `Body` lines 182–190 render `state.streamed` only. `popupNotes` returns an empty list unless `phase === 'done'` (line 147). Exact equality returns before the algorithm (`diff.ts` line 6). The popup also skips the diff when the answer is unchanged (`Popup.tsx` line 193).

**Measured** with `wordDiff` and `findMissingTokens` in Node 26.10.0, at 00:49 EEST, fake strings:

| Case | Time | Parts |
| --- | --- | --- |
| 300 words, a few edits, mean of 20 | 0.21 ms | 60 |
| 2,000 words, scattered edits, mean of 10 | 1.80 ms | 300 |
| Same 2,000-word pair, 30 repeats | 1.78 ms each | 300 |
| 8,000 words, scattered, mean of 3 | 7.07 ms | 600 |
| Arabic plus English, 800 words, mean of 10 | 0.24 ms | 72 |
| Identical 5,000 words, mean of 50 | about 0 ms | 1 |
| 1,200 words, every third word different | 27.3 ms | 1,200 |
| 1,500 words, no shared words | 201.2 ms | 2, timeout shape |
| 3,000 words, no shared words | 200.9 ms | 2, timeout shape |
| 100,000 characters, no spaces, one extra character | 0.12 ms | 2 |

The 100,000-character case is one token replaced. It is not the timeout. The two-part shape matches both a real full replace and the timeout fallback, so the 201 ms clock is the evidence for the cap. No case in this run ran much past 200 ms. One edit-length iteration could still run longer. That was not seen.

Token scan: 200 URLs, mentions, hashtags, code spans, and emoji, 14,359 characters, `findMissingTokens` mean 1.87 ms (801 tokens extracted). Plain 5,000 words, mean 0.25 ms. Arabic-script check, mean 0.03 ms. Shorter-mode `[...text]` on 20,000 emoji, mean 0.12 ms. `cleanOutput` on 2,000 words, mean 0.07 ms. Cleanup runs once at `rewrite.ts` line 71, after the stream, so it is not a per-chunk cost.

**Hypothesis, unmeasured:** building 1,200 DOM nodes for the heavy case costs more than the 27 ms algorithm. Caching does not remove the first paint.

**Smallest change:** On `done`, store the diff parts and the notes on popup state. Later renders read them. `start`, `retry`, and a new answer drop the cache. Store the idle badge count as today, and keep the parts on that field’s slot so opening the marker does not diff again. Hold those strings only as long as the popup session or the marker already holds the answer. No module-global cache after the marker is gone.

**Benefit:** A heavy rephrase pays the 27 ms or the 200 ms cap once. Copy and toggling Changes do not pay it again. A normal 300-word Fix saves about 0.2 ms per repeat, which the user will not feel. The win is the heavy and pathological answers.

**Risks:** The cache must key off the same input and result strings. A timeout fallback must stay: whole text as one delete and one add, badge count 1 for that shape (`countChanges` treats a delete plus an add as one group). Do not persist the draft. Do not drop the 200 ms cap.

**Effort:** small. **Priority:** medium. Normal Fix text does not justify it. The timeout repeat does.

**Acceptance:** Call `wordDiff` once for a 1,200-word every-third-word pair, then render Copy and Changes ten times and assert the algorithm is not called again. A 1,500-word no-overlap pair still returns in about 200 ms with two parts on the first call only. Streaming a chunk does not call `wordDiff` or `findMissingTokens`.

### G06. Measure the selection button only after the debounce

**Where:** `src/content/button.ts` lines 56–65. `wanted` lines 23–26 calls `selectionCaret` lines 72–89. For a non-collapsed input or textarea, that calls `fieldFocusCaret` in `src/content/caret.ts` lines 50–75. `DEBOUNCE_MS` is 150 (line 16). `update` calls `wanted` again.

**Trigger:** Every `selectionchange` in every frame, while a field has a non-collapsed selection. Dragging a selection fires this many times a second. A collapsed caret returns before the mirror (lines 75–76), so ordinary typing does not build it.

**Costly work:** `getComputedStyle` for about 30 properties, a hidden mirror appended to the document, then `offsetTop`, `offsetLeft`, and `offsetHeight`, which force layout. The mirror is removed. Contenteditable uses `getClientRects` instead (`focusCaret` lines 35–46). The debounce delays the Preact render only. The first measure is on the event.

**Measured:** none. Layout cost is a browser hypothesis. The call pattern is a code fact.

**Smallest change:** On `selectionchange`, decide with no geometry: enabled, popup closed, and a non-collapsed selection inside an editable (`findEditable` plus selection offsets). If that is false, hide immediately. If it is true, debounce `update`, and let `update` be the only `fieldFocusCaret` or `focusCaret` call.

**Benefit:** Drag-selecting text does one layout after the user pauses, not one per event. The button still waits the same 150 ms to appear.

**Risks:** Hiding must stay immediate when the selection collapses, including a selection that is not in an editable. Position math stays in `placeButton`. Blocklist checks stay. An empty blocklist already returns before URL parsing (`content.ts` lines 65–71).

**Effort:** small. **Priority:** medium.

**Acceptance:** In a performance trace, drag-selecting inside a textarea forces layout once per pause, not once per `selectionchange`. Collapsing the selection hides the button without waiting 150 ms. The existing “button follows a textarea selection” test still passes.

### G07. Paint stream chunks once per frame, and do not deliver idle chunks to the page

Two separate hypotheses.

**Popup streaming.** `src/content/controller.ts` `onEvent` lines 201–205 calls `dispatch` on every chunk, which re-renders the whole popup (lines 139–159). `popupReducer` appends with `state.streamed + action.text` (`popupState.ts` lines 97–99). The background does the same with `raw += text` (`rewrite.ts` lines 46–49). `Popup.tsx` lines 58–74 read `offsetWidth` and `offsetHeight` from a `ResizeObserver` when the box changes.

**Measured:** string append is cheap in this Node. 2,000 chunks of 4 characters: 0.02 ms. 50 chunks of 2,000 characters: about 0 ms for 100,000 characters. SSE parse of 5,000 small events: 2.63 ms (`readSSE`). Those are not the hotspot.

**Hypothesis:** Claude and Grok emit one `text_delta` per `parseLine` hit (`bridge/lib.mjs` lines 190–200). Each becomes a native message, a port message, and a Preact render. Codex sends the whole answer on `item.completed` (lines 218–221), then `turn.completed`. Codex popup streaming is one chunk. Render cost per chunk was not measured.

**Idle chunks.** `readOutcome` (`idle.ts` lines 428–435) accepts only `done` and `error`. Chunks still arrive and run the listener. The user can be typing while that request is in flight (`pending` at lines 113–115).

**Smallest change:** In the popup controller, fold chunks into one render per animation frame. If `done` or `error` arrives first, drop the pending frame. `dispatch` already ignores chunks once the session is closed or the phase is no longer streaming. In `runRewrite`, when `trigger === 'idle'`, post `done` and `error` only. Keep accumulating `raw` so `cleanOutput` still sees the full answer.

**Benefit:** A token-by-token answer repaints about once per frame. An idle run does not wake the page for text it discards. Codex changes little, because it already sends one big chunk.

**Risks:** Order stays in order. `done` still carries the cleaned full text, not a joined preview. Cancel still aborts the port. Idle usage and the blocked-host check stay. Do not drop `done`. Chunk rates are unmeasured, so this may save little if the CLI already batches.

**Effort:** small. **Priority:** medium-low until a browser trace shows chunk frequency.

**Acceptance:** A fake stream of 100 single-character chunks produces one popup text update per frame, then one `done`. An idle fake stream posts no `chunk` messages and one `done`. Disconnect during the stream still ends with no late render.

### G08. Send the page settings inside the change message

**Where:** `src/entrypoints/background.ts` lines 104–120 send `{ type: 'page-settings-changed' }` to every tab, with no body. `chrome.tabs.sendMessage` without a frame id reaches every frame. `src/entrypoints/content.ts` lines 99–106 then call `refresh` (lines 46–56), and each frame asks for `page-settings`. The background loads settings again per frame (lines 198–205). The payload type already exists: `PageSettings` is `blocklist`, `idleFix`, and `defaultMode` (`src/core/messages.ts` lines 29–36).

**Trigger:** Every saved settings change, once per frame in every tab. Startup still needs one read per frame. That part is fine.

**Costly work:** Extra storage reads and message round trips. The content-script `refresh` itself is small when no marker is showing: `renderMarks` returns quickly. Storage latency was not measured.

**Smallest change:** On `storage.onChanged` for settings, `loadSettings()` once and send `{ type: 'page-settings-changed', settings: { blocklist, idleFix, defaultMode } }`. Frames apply that object and refresh the marker and button. Keep the `page-settings` query for first load.

**Benefit:** One storage read per save, not one per frame. Toggling idle Fix on a window full of Gmail frames does less work.

**Risks:** The message must use the same three fields as today’s reply. No API keys, models, or URLs. A second save sends a second message. Frames that miss it still load on the next navigation. Blocked-ancestor behavior stays in the content script.

**Effort:** small. **Priority:** low.

**Acceptance:** One settings write with two frames produces one `loadSettings` and both frames show the new idle flag. A content-world listener still cannot read `chrome.storage`. The message object has only those three fields.

## 3. Rejected ideas

**A resident bridge process.** Each rewrite pays about 43.6 ms of Node before the CLI, then seconds of model time. Chrome tears the host down when the port closes, and the service worker sleeps. A warm host would save the Node start, not the CLI start, and would need a port that keeps the worker awake. The version-probe fix in G01 covers the popup delay. Bench docs already list a long-lived process as “maybe later”. Still not justified.

**Dropping `all_frames`, `match_about_blank`, or `match_origin_as_fallback`.** Editors in iframes need them. `dist/content-scripts/content.js` is 58,426 bytes, gzip 20,876, and Node compiled it in 3.18 ms. Twenty frames are on the order of tens of milliseconds once, at `document_idle`. That is not the continuous cost.

**Splitting the popup out of the content script, or deep-importing `diff`.** The content bundle includes Preact, the popup, inline CSS, and extra `diff` tokenizers (sentence, CSS, JSON) because the package entry pulls them in. 58 KB gzipped to 21 KB is too small for a loader change. Idle still needs `wordDiff` for the badge, so the library cannot leave the first script anyway.

**Rewriting SSE parsing or chunk string appends.** 5,000 SSE events took 2.63 ms. Appends of 100,000 characters took about 0 ms in Node. `bridge/lib.mjs` `createDecoder` already uses `Buffer.subarray`.

**Caching blocklist URL parsing.** `isBlocked` (`settings.ts` lines 171–178) parses every rule with `new URL` on each call. Forty rules and three hosts: 0.012 ms naive, 0.0009 ms with rules already normalized, per triple check. A selection event can afford that. An empty blocklist returns first (`content.ts` lines 67–68).

**Starting the provider in parallel with `recordUsage`.** `rewrite.ts` waits for the count, then checks the abort signal again. Tests require that a cancel during the save does not start the provider. A started attempt still counts. Keep the wait.

**Caching full settings in the service worker to skip the per-request `loadSettings`.** One storage read beside a CLI start is noise, and a stale cache can apply the wrong provider or blocklist.

**Shortening `waitForRender` (150 ms before rich Accept, 50 ms after).** `editable.ts` lines 225 and 298. Those waits exist so Slate and paste handlers settle. They run once per Accept.

**Removing Claude `--verbose`.** Stream JSON partials are requested with it (`bridge/lib.mjs` lines 130–134). No evidence it is optional.

**Virtualizing the diff, or opening long answers on Final automatically.** First paint of 1,200 parts was not measured in a browser. G05 stops repeat work. Change the view only if a trace shows DOM build dominating.

**Cancelling an idle request when the popup closes.** `controller.ts` `close` lines 127–136 does not call `cancelWaiting`. The in-flight answer can still become a marker. The process has already started.

**Lowering the 3-second idle delay, or turning idle off by default.** Product behavior, not a measured waste.

**New telemetry or a draft log.** Rejected. Acceptance tests can use the fake provider and `performance` traces.

## 4. Coverage, commands, gaps, order

**Checked, with a proposal:** content boot and settings messages (G08), idle timer, marker loop, and idle send (G02, G03, G04, G07), selection button and caret mirror (G06), popup stream versus done-state diff and notes (G05, G07), bridge ping and host lifecycle (G01), settings and usage write path (G08, and the rejected parallel count).

**Checked, no change:** `src/background/sse.ts` and both HTTP providers (SSE cost above). `cleanOutput`, Arabic-script check, shorter character count. `recordUsage` serialization (`usage.ts` lines 41–54) is one get plus one set per attempt, on purpose. Accept, paste, and Backspace waits. Prompt size (`prompts.ts` is a short system string). Background bundle 17,004 bytes, gzip 6,278, compile 0.74 ms. Production JS has no `draft-js`, `prosemirror`, `@lexical`, `quill`, or React entry. The Vite chunk named `tokens-*.js` (30,991 bytes) is shared Preact and settings for the popup and options, not `extractProtectedTokens`. That scanner is inside `content.js`. Detached editors are dropped on the next `renderMarks` (`idle.ts` lines 317–319), and the interval stops when `marked` is empty. Codex temp-dir write is a small instructions file per run, next to CLI startup.

**Tests and benches, not user runtime:** `popup.spec.ts` fakes the 3-second pause with the clock. `extension.spec.ts` still has several real `waitForTimeout(4500)` calls. That is CI time. `bench/bench.mjs` and `bench/probe.mjs` call real CLIs. They were not run. `docs/benchmarks/2026-10-17-fix-mode.md` is historical model quality and latency. The bridge has since sent `done` at the stop event instead of process exit.

**Commands that actually ran:**

- `git rev-parse HEAD` → `3638cb03036bb675a8923a99dd715146a66b9dc1`. Working tree clean after the review.
- Bundle sizes and a 25-entry `PATH` count. `node_modules/diff/libesm` source is 104,092 bytes.
- `node /tmp/localpolish-performance-3YoNOS/bench.mjs` at 00:49:11 EEST. It printed the diff, token, cleanup, blocklist, SSE, concat, `findOnPath`, fake-sleep, `content.js`, and `background.js` rows, then died:

```text
SyntaxError: Unexpected token 'export'
    at new Script (node:vm:118:7)
    at gzipSize (.../bench.mjs:293:3)
```

`vm.Script` cannot compile `dist/chunks/tokens-CdWuEuje.js` because it is an ES module. Gzip and compile times for `tokens-*.js` and `popup-CkZ5Cr-s.js` were not produced. The host-startup loop in that same script never ran.

- A second `node --input-type=module` command did run. It measured the 1,200-word diff (27.29 ms, 1,200 parts) and five host EOF starts (42.3–46.7 ms, all exit 0).

**Missing evidence:** browser traces for scroll, `innerText`, caret mirror, and popup render per chunk. Real `claude` / `codex` / `grok --version` times. Live chunk counts. Chrome storage latency. How often hidden tabs actually fire idle. The orchestrator’s browser pass is the right place for those.

**Order:** G01, G03, G02, G06, G05, G07, G04, G08. G02 keeps the 250 ms interval. G05’s cache can land before a browser DOM trace. Do not virtualize the diff in that step. G04 waits until G03 is in, so the cap is not doing the hidden-tab job.

## 5. Files touched and blockers

No repo files were edited, staged, or committed. No push. The temp bench directory was removed by the last command of the previous turn, which also killed the runner. This recovery did not delete anything and did not re-run the benches.

No product blocker. The report gap is the unfinished `vm.Script` tail and the lack of browser numbers.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.

None. The useful method was “time the pure functions, do not run the real CLIs, and separate stream work from done-state work.” That was specific to this brief. A skill would not earn its keep unless the same audit is repeated on several extensions.

**Next:** Nothing from you. The orchestrator can check these proposals and run the browser sweep. Nothing is running in this session.

**Result:** Reviewed LocalPolish 1.1.0 at `3638cb0` from the sources already read. Recorded Node numbers for diff, tokens, SSE, blocklist parsing, and host startup. The first bench script stopped on an ES module parse error before host startup. A second command measured host EOF and the 1,200-word diff. No browser profile and no real CLI. No code changes.
