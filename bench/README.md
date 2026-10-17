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

## Still to do

1. Run `probe.mjs`.
2. Send the results to Sol (`review` lane, high, read-only) and ask what in our setup slows things down or lowers quality.
3. Likely fix: send `done` at the final event and stop the CLI, instead of waiting for it to exit.
