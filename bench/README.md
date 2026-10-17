# Fix-mode benchmark

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

## Results so far (Windows, 2026-10-17)

The full table is in `results/2026-10-17-win-report.md`. It has 4 rounds, so 20 tries per setup.

Findings so far:

- **The bridge sends `done` only when the CLI exits** (`bridge/host.mjs`, `child.on('close')`). Haiku's API time is about 1.6 s. Its answer shows at about 1.6 s, but the process runs 2 to 3 s more before it exits. The diff and Accept wait for that exit.
- **Codex sends about 13,000 input tokens for a one-line fix.** That is its built-in prompt. `model_instructions_file` exists in codex 0.162 and may replace it. This is untested.
- **Grok sends about 9,600 to 10,800 input tokens** and costs about $0.007 per fix, about 30 times Haiku. Grok loads `~/.claude` rules. `GROK_CLAUDE_RULES_ENABLED=0` and the other `GROK_{CLAUDE,CODEX,CURSOR}_{AGENTS,HOOKS,MCPS,RULES,SKILLS,SESSIONS}_ENABLED` switches are in the binary. This is untested.
- **Haiku missed the email test 4 of 4 times.** It left "hi" lowercase and wrote "reports are". Luna turns the Arabic part of mixed Arabic into Franco-Arabic.
- Prices: Luna is about $0.10 per 1M input tokens and $0.50 per 1M output. Sol is $2 and $10. These come from secondary sites, not OpenAI.

## Probe results (Mac, 2026-10-17)

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

## Fixed

1. The bridge sends `done` at `message_stop` (Claude Code, Grok) or `turn.completed` (Codex), then stops the CLI. Live, through `bridge/host.mjs`: Haiku `done` at 1.8 s (was about 4.5 s), Luna at 3.3 s.
2. Grok runs with its Claude, Codex and Cursor imports off (`GROK_IMPORTS_OFF` in `bridge/lib.mjs`). Grok 4.7 `done` at 2.8 s live.
3. Codex runs with our system prompt as its base prompt (`model_instructions_file`, written to the temp folder of each run).

4. From Sol's review (2026-10-17): the bridge finishes early only on `stop_reason` `end_turn` or `stop_sequence`, and reports `max_tokens` as a cut-off answer. Codex no longer gets the prompt twice. Cleanup no longer collapses `,,` in text where it replaced no dash, and keeps a heading such as `Corrected:` when the input starts with one.

## Still to do

1. Test Sol's Fix prompt against the current one, with new fragment and subject-line inputs (see below).
2. Maybe later, each needs measuring: more Codex config keys (`features.multi_agent`, `features.goals`, `tools.view_image`), an isolated `GROK_HOME`, Claude `--disable-slash-commands`, and a long-lived bridge process.
