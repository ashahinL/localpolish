# Benchmarks

## Portable offline runtime benchmark

Run P00a against the existing built extension. This command uses synthetic text, loopback HTTP, and a fake native CLI. It does not use the paid CLI benchmarks documented below.

```bash
npm ci
npm run build
npx playwright install chromium
node --test bench/runtime/fixtures.test.mjs
npm run bench:runtime -- --smoke --out-dir /tmp/localpolish-runtime-smoke-1
npm run bench:runtime -- --smoke --out-dir /tmp/localpolish-runtime-smoke-2
npm run bench:runtime
```

Use Node 22 or later. `--out-dir DIRECTORY` selects the report directory. The default is `bench/results`. Paths to the extension and source files resolve from the checkout, so the command also works from another working directory. Missing `dist/manifest.json` fails with a build instruction. No dependency or login is required beyond the project's installed packages and Playwright Chromium.

Full mode requests ten cold and ten warm samples for **each of 15 scenarios**. Smoke requests one of each with the same fixture sizes. Neither mode changes production settings defaults or delays. The synthetic provider sends rewrite preview chunks 75 ms apart so the real streaming UI can be observed before ready. These timings include local harness work and are not model-latency measurements.

Cold browser samples use a fresh Chromium process, profile, worker, and editor. Warm samples reuse the final cold session and repeat the operation in the same browser, worker, and editor without reloading. Core cold samples use fresh Node workers. Core warm samples reuse their imported functions and fake Chrome storage boundary. The native host is single-use. Its warm samples reuse the Node harness but still start a fresh host and fake CLI. Reports label that difference.

The launch helper is shared with `tests/e2e/extension.spec.ts`. Before launch, the benchmark copies `dist` into a unique temporary directory and reads `manifest.background.service_worker`. It prepends only the existing native-message stub and query counters to that copied built worker. All original worker bytes follow unchanged. The manifest bytes and key stay unchanged, so the extension ID stays the same. The stub runs before production startup can open the setup page or reach an installed native host. The normal extension launch flags load this runtime copy. The original `dist` and production source files are not edited by the harness. `buildHash` identifies the original checkout build, not the instrumented runtime copy. Cleanup removes the copy after closing the extension, on both setup failure and normal close. Later isolated-content-world CDP counters remain in use. Only core probes compile the listed TypeScript modules to temporary CommonJS files.

The rich-editor fixture changes its last six-byte word on each operation. Its byte and word counts stay constant. This allows warm requests to run while preserving the production rule that unchanged fields are not sent twice.

The scenarios cover the following work:

| Scenario                                   | Synthetic fixture and check                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `rewrite-small`                            | Exact 15-byte input and 12-byte answer, first real preview, ready result, one request                                              |
| `rewrite-multilingual`                     | Mixed Arabic and English, exact answer, preview and ready, one request                                                             |
| `diff-1500-no-overlap`                     | 1,500 distinct words on each side, Final then Changes three times, exact answer and one request                                    |
| `selection-100`                            | 100 selection events over a 2,000-word textarea, immediate and settled isolated-world style and rect calls                         |
| `idle-off`                                 | Ten typed characters, idle timer counts, no request after a 3,300 ms observation                                                   |
| `rich-marker`                              | A 1,200-word rich editor, one idle rewrite, 900 ms of reads, geometry, and marker DOM mutations                                    |
| `api-native-checks`                        | Options, toolbar popup, and setup using the API provider, mocked native-check counts                                               |
| `connection-owner-close`                   | Held SSE Test connection, active streams and cancellation 500 ms after the owner closes, then explicit release                     |
| `model-settings-frames`                    | Model-only storage change, main editor plus a page with three child frames, page-settings query counts                             |
| `open-close-retention`                     | Three real rewrite popup open/close cycles, exact answers and three requests, DOM, listener, pending-work and heap observations    |
| `rewrite-1000-manual`, `rewrite-1000-idle` | Actual `runRewrite`, 1,000 synthetic chunks, exact final text and message counts                                                   |
| `native-frame-1k`                          | Actual decoder, a roughly 2 MiB frame in 1 KiB fragments, split UTF-8, exact decoded message and concat-copy counts                |
| `sse-1k`                                   | Actual `readSSE`, a roughly 2 MiB single line in 1 KiB fragments, mixed UTF-8, CRLF and a second event, exact output               |
| `host-ready-before-close`                  | Actual host, framed request and events, one fake CLI that emits completion and stays alive, actual process-liveness check at ready |

The host's PATH contains only its fake executable and a link to `process.execPath`. Its HOME, CODEX_HOME, and temporary directory are private to the run. No installed provider CLI or authentication file is used. On Windows the fake uses an npm-style shim. On POSIX, the fake waits 250 ms after SIGTERM so ready and process close remain separate observations. Windows uses forced process cleanup; child liveness at ready is an observation there. The host must clean its own temporary directory.

Each run writes `runtime-<mode>-<Cairo timestamp>-<pid>.json` and a `.samples.jsonl` file. The JSON contains every raw sample, per-temperature medians and maxima, source commit and content hash, build hash, OS, CPU, memory, Node, Playwright, Chromium, exact byte sizes, and Cairo timestamps. The JSONL contains the attempted raw samples for separate analysis. Heap snapshots use the same filename prefix. They stay local or in CI artifacts and are not committed. Retention iteration zero saves snapshots before and after its cycles in each temperature. Snapshots may trigger GC and change memory observations.

Interpret these reports as a synthetic baseline. Baseline inefficiencies such as idle chunk messages, repeated native checks, selection layout work, and uncancelled connection tests are observations. Loose counter ceilings catch runaway work. Exact answers, stream decoding, request counts, ready events, popup cleanup, and fake-process cleanup gate smoke. There are no machine-specific speed or heap thresholds, percentile claims, battery claims, or model speed claims. Compare identical fixture hashes and repetition counts on the same environment before drawing timing conclusions. The 2 MiB single-line SSE case deliberately measures today's unbounded behavior; later limit tasks may need to change its expected result explicitly.

CDP listener and DOM counters cover the renderer, not just extension objects. The exact extension listener count is unavailable and is recorded as `null` with a reason. Pending-work counts include only content-world timers, intervals, and animation frames scheduled after instrumentation. They exclude existing work and worker internals. Marker mutation counts measure DOM updates. Exact bundled Preact render-call counts are unavailable and are also `null`, rather than fabricated zeroes. Timing windows and count ceilings are in `bench/runtime/browser.mjs`.

The Playwright configuration and shared launcher reject `process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt'` before spawning Chrome, with an instruction to use the unrestricted reviewer. Do not retry sandbox browser failures. SIGINT and SIGTERM are checked before each sample and after asynchronous setup or warmup; an interrupted run closes its owned session and stays incomplete.

A blocked browser launch or failed assertion returns a nonzero exit and preserves an `incomplete` report. A shared browser setup failure blocks the remaining browser scenarios explicitly, with missing sample counts. The full run still executes all ten cold and ten warm core samples. It never substitutes core code for browser measurements. A report with missing browser samples is **not a completed baseline**.

CI runs the fixture checks and a smoke benchmark after its existing build and Chromium installation. Smoke has a three-minute step limit within the existing fifteen-minute job. The report, JSONL, and heap snapshots upload even after failure. The upload action is pinned to the [official v4.6.2 commit](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02). P00b's duplicate-build cleanup is separate.

> Results from 17 October 2026. The bridge and the default have changed since. Today the default is Codex `gpt-6-luna` at effort `none` (`src/core/settings.ts`), and the Fix prompt is in `src/core/prompts.ts`.

## Paid Fix-mode benchmark

Runs the same CLI commands the bridge runs (`bridge/lib.mjs` `buildCommand` and `parseLine`), on 5 test inputs, and scores each answer.

```bash
node bench/bench.mjs . bench/results/<name>.jsonl 4
```

The last argument is the number of rounds. Each round runs every input on every setup, one call at a time. An optional fourth argument filters setups by name, for example `grok`.

```bash
node bench/report.mjs bench/results/*.jsonl
```

`report.mjs` rescores the saved answers with `inputs.mjs`, so a scoring fix needs no rerun.

`probe.mjs` measures three things on 3 inputs:

- How long each CLI keeps running after its final event (`result` or `turn.completed`).
- Grok with its Claude, Codex and Cursor imports off (`GROK_*_ENABLED=0`).
- Codex with its built-in prompt replaced by ours (`-c model_instructions_file=...`).

```bash
node bench/probe.mjs . bench/results/<name>-probe.jsonl 2
```

### Results so far (Windows, 2026-10-17)

The full table is in `results/2026-10-17-win-report.md`. It has 4 rounds, so 20 tries per setup.

Findings so far:

- **The bridge sends `done` only when the CLI exits** (`bridge/host.mjs`, `child.on('close')`). Haiku's API time is about 1.6 s. Its answer shows at about 1.6 s, but the process runs 2 to 3 s more before it exits. The diff and Accept wait for that exit.
- **Early Codex runs used about 13,000 input tokens for a one-line fix.** That total includes the base prompt and other coding-agent context. It is not all the base prompt. The later own-base-prompt probe below reduced Luna to about 9,400 input tokens. See the [follow-up context investigation](../docs/audits/performance-1.1.0.md#s06-follow-up-inspect-and-reduce-codexs-inherited-context).
- **Grok sends about 9,600 to 10,800 input tokens** and costs about $0.007 per fix, about 30 times Haiku. Grok loads `~/.claude` rules. `GROK_CLAUDE_RULES_ENABLED=0` and the other `GROK_{CLAUDE,CODEX,CURSOR}_{AGENTS,HOOKS,MCPS,RULES,SKILLS,SESSIONS}_ENABLED` switches are in the binary. This is untested.
- **Haiku missed the email test 4 of 4 times.** It left "hi" lowercase and wrote "reports are". Luna turns the Arabic part of mixed Arabic into Franco-Arabic.
- Prices: Luna is about $0.10 per 1M input tokens and $0.50 per 1M output. Sol is $2 and $10. These come from secondary sites, not OpenAI.

### Probe results (Mac, 2026-10-17)

`results/2026-10-17-mac-probe.jsonl`, 2 rounds of 3 inputs, so 6 tries per setup. Times are medians in seconds.

| Setup                       | Pass | First text | Final event | Exit | Input tok | Output tok |
| --------------------------- | ---- | ---------- | ----------- | ---- | --------- | ---------- |
| Haiku 5.5 low               | 4/6  | 1.8        | 4.6         | 5.4  | 971       | 58         |
| Luna none                   | 6/6  | 3.8        | 3.8         | 4.8  | 12861     | 42         |
| Luna none + own base prompt | 6/6  | 3.6        | 3.6         | 4.5  | 9372      | 42         |
| Grok 4.6 low                | 5/6  | 5.4        | 5.8         | 6.6  | 9558      | 257        |
| Grok 4.6 low + imports off  | 5/6  | 4.8        | 5.2         | 6.0  | 6533      | 230        |
| Grok 4.7 low + imports off  | 6/6  | 3.9        | 4.1         | 5.4  | 7569      | 228        |

Findings:

- **Claude Code writes a summary after the answer.** One Haiku run, event by event: the text at 1.3 s, `message_stop` at 1.5 s, a `post_turn_summary` event at 3.7 s, `result` at 3.7 s, exit at 4.5 s. The final event column above is `result`, so it hides this.
- Every CLI runs about 1 s after its final event before it exits.
- Grok without its Claude, Codex and Cursor imports sends about 3,000 fewer input tokens. Once, with imports on, Grok added the `~/.claude/CLAUDE.md` answer format ("**Next:** ... **Result:** ...") to a grammar fix.
- Codex with `model_instructions_file` sends about 3,500 fewer input tokens, with the same score.

### Fixed

1. The bridge sends `done` at `message_stop` (Claude Code, Grok) or `turn.completed` (Codex), then stops the CLI. Live, through `bridge/host.mjs`: Haiku `done` at 1.8 s (was about 4.5 s), Luna at 3.3 s.
2. Grok runs with its Claude, Codex and Cursor imports off (`GROK_IMPORTS_OFF` in `bridge/lib.mjs`). Grok 4.7 `done` at 2.8 s live.
3. Codex runs with our system prompt as its base prompt (`model_instructions_file`, written to the temp folder of each run).

4. From Sol's review (2026-10-17): the bridge finishes early only on `stop_reason` `end_turn` or `stop_sequence`, and reports `max_tokens` as a cut-off answer. Codex no longer gets the prompt twice. Cleanup no longer collapses `,,` in text where it replaced no dash, and keeps a heading such as `Corrected:` when the input starts with one.

### Fix prompt test (Mac, 2026-10-17)

`results/2026-10-17-mac-prompt.jsonl`. 7 inputs, 3 rounds, so 21 tries per row. Two new inputs: a subject line, and a fragment cut from a longer sentence (`i has an apple`), where a final period is wrong. `BENCH_PROMPT=v1|sol|v2` picks the prompt. Times are to process exit, so they include the 1 to 3 s the bridge no longer waits for.

| Setup        | v1 (old) | sol   | v2 (now in `prompts.ts`) |
| ------------ | -------- | ----- | ------------------------ |
| Luna none    | 12/21    | 18/21 | 19/21                    |
| Haiku low    | 9/21     | 5/21  | 9/21                     |
| Haiku medium | 11/21    | -     | 10/21                    |

- v2 keeps v1's first sentence and adds short rules: capitalize greetings and names, keep singular or plural, keep each part's script, do not transliterate, add no final punctuation.
- Sol's prompt starts with "Make minimal edits". Haiku then often returns the text unchanged.
- Haiku misses with every prompt: "reports are" in the email, a final period on the fragment, and sometimes "I has an apple" left as it is. Luna's misses are in the mixed Arabic test.

### Luna effort (Mac, 2026-10-17)

`results/2026-10-17-mac-luna-effort.jsonl`, v2 prompt, 21 tries each.

| Effort | Score | Median | Reasoning tokens | Output tokens |
| ------ | ----- | ------ | ---------------- | ------------- |
| none   | 18/21 | 4.4 s  | 0                | 28            |
| low    | 17/21 | 4.4 s  | 0                | 28            |
| medium | 18/21 | 4.5 s  | 0                | 28            |

Luna does not think on Fix-sized text at low or medium either, so the three efforts give the same answers, time and tokens. The cost differences between runs come from how much input was cached, not from effort. Rephrase and Tone were not tested.

### Still to do

1. Maybe later, each needs measuring: more Codex config keys (`features.multi_agent`, `features.goals`, `tools.view_image`), an isolated `GROK_HOME`, Claude `--disable-slash-commands`, and a long-lived bridge process.
