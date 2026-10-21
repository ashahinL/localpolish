# T21c. Antigravity provider

Lane: Sol medium (`second`). Follow the `implement-plan` skill in its light form: build, test, keep the plan current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. The owner reviews the diff.

Repo: LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest, Playwright), plus a Node native-messaging bridge in `bridge/` that runs local AI CLIs. Plan: `docs/plans/features-1.3-1.4.md`, task T21c. **Read `docs/plans/cli-spike.md`, section "Antigravity (`agy`)", first.** It has the exact command, agent file, events and failure modes, all checked on the real CLI.

## Goal

Add Google Antigravity's CLI (`agy`) as a new CLI provider, `antigravity-cli`, locked down like Claude, Codex and Grok: no tools, no rule files, no plugins, no saved conversations, and our own system prompt.

The bridge's CLI name is `agy`, the binary's name. The extension's provider id is `antigravity-cli`. The user-facing name is "Antigravity CLI".

## Bridge (`bridge/`)

1. **Private home.** Add `agyHomeFor(home, platform)` in `lib.mjs`, next to `codexHomeFor`: `path.join(supportDir(home, platform), 'agy-home')`. Add `agyLoginCommand(agyHome, platform)`:
   - macOS and Linux: `mkdir -p "<agyHome>" && HOME="<agyHome>" agy`.
   - Windows: `$env:HOME="<agyHome>"; $env:USERPROFILE="<agyHome>"; mkdir -Force $env:HOME | Out-Null; agy`.

   Mark the Windows command as unverified in a short comment. Nobody has run `agy` on Windows yet.
2. **`buildCommand('agy', { model, effort, system, … })`** returns
   `{ cmd: 'agy', args: ['--agent', 'localpolish', '--output-format', 'stream-json', '--input-format', 'stream-json', '-p=', …] }`.
   - Add `--model <model>` when it is set, and `--effort <effort>` when it is set.
   - Nothing from the draft or the system prompt goes on the command line.
3. **`host.mjs` `handleRewrite` for `agy`:**
   - Set `env.HOME` to the agy home, and on Windows also `env.USERPROFILE`. Create the folder if it is missing.
   - In the per-run temp `dir` (already the child's `cwd`), write `.agents/agents/localpolish.md` with this frontmatter, then a blank line, then the `system` text as the body:

     ```yaml
     ---
     name: localpolish
     description: LocalPolish rewrite.
     tools: []
     mainAgent: true
     subagent: false
     ---
     ```

     Never write an agent file into the agy home. Two runs at once would race on one file.
   - Write exactly one line to stdin: `JSON.stringify({ event: 'user', message: { content: user } }) + '\n'`, then end stdin. Today the other CLIs get `user` raw (`host.mjs` about line 366). Keep that for them.
   - **Login missing.** When stderr contains `Authentication required`, kill the child right away and finish with: `Antigravity needs its own login for LocalPolish. In a terminal run: <agyLoginCommand(...)>`. Don't wait for agy's own 60-second login timeout.
   - **Cleanup.** Read the `conversation_id` from the `init` event. After the child exits, delete `<agyHome>/.gemini/antigravity-cli/conversations/<id>.db` and the folder `<agyHome>/.gemini/antigravity-cli/brain/<id>/`.
     - Do this on every path: success, error, timeout and disconnect.
     - Check that the id matches `/^[0-9a-f-]{36}$/i` before using it in a path.
     - Only ever delete inside the agy home.
   - Add `agy` to `CLI_NAMES` in `host.mjs` and `install.mjs`, and to the `found` record and its JSDoc type. The installer then adds agy's folder (for example `~/.local/bin`) to the wrapper's PATH. Print the agy login command after install when `agy` is found, like the Codex line at `install.mjs:120`.
4. **`parseLine('agy', line)`:**
   - `init` returns `{ model }` when `init.init.model` is a valid name, using `reportedModelName`. The host also keeps `conversation_id` for cleanup. Give `parseLine` a way to return it, for example `{ conversation: id }`, or read it in the host. Choose the smaller change.
   - A `step_update` with `step_type === 'agent_response'` and a non-empty `text_delta` returns `{ text }`.
   - A `result` with `status === 'SUCCESS'` returns `{ end: true }`. Any other status returns `{ error: result.error || 'Antigravity stopped (<status>).' }`.
   - Everything else returns `null`.

   The final `DONE` delta is `"\n"`. Pass it through. The extension's existing output cleanup trims trailing whitespace. Check that it does, and say so in the report.

## Extension (`src/`)

5. **Settings** (`src/core/settings.ts`):
   - Add `'antigravity-cli'` to `ProviderId` and `CliProviderId`.
   - Default model `gemini-3.8-flash-low`. Default effort `''`, meaning the model's own level, because the Flash model names already include it.
6. **Providers:** `src/background/providers/index.ts` gets `case 'antigravity-cli': return cliProvider('agy');`. `cli.ts` gets `CliName` and `MODEL_KEY`.
7. **Bridge status.**
   - `BridgeStatus.clis` (`src/core/messages.ts`) gains `agy`.
   - `readPong` in `cli.ts` must accept a pong **without** `agy`, from a bridge that wasn't updated yet, and treat it as `agy: null`. A pong with a bad `agy` value is still rejected.
   - Update the popup bridge card and summary (`src/popup/summary.ts`, short label `Ag`), and `CLIS` in `src/options/sections.tsx`.
8. **Options and the popup Provider picker.**
   - `ProviderSection.tsx` gets a card: "Antigravity CLI", subtitle "Your Google account, via the bridge". Treat it as a CLI provider wherever `isCli` is checked.
   - Show the agy login command, like the Codex one, for both macOS/Linux and Windows.
   - Model presets (`src/options/presets.ts`): `gemini-3.8-flash-low` (Gemini 3.8 Flash, low), `gemini-3.8-flash-medium`, `gemini-3.8-flash-high`, `gpt-oss-120b-medium` (GPT-OSS 120B), `claude-sonnet-4-6` (Claude Sonnet 4.6).
   - Efforts: a single preset `{ value: '', label: 'Model default' }`, plus low, medium and high.
9. **Where the text goes** (`src/setup/destination.ts`): "Your text goes from this computer, through the bridge, to the Antigravity CLI, which sends it to Google. LocalPolish deletes each Antigravity conversation after the answer."
10. **Docs.**
    - README: a setup section for Antigravity. Install `agy`, run `npm run bridge:install` again, then run the one-time login command.
    - `PRIVACY.md`: the destination, the private home folder, and the per-run deletion.
    - The README's troubleshooting list gets the login error message.

## Tests

Use made-up text only. Never run the real `agy`.

- `bridge/lib.test.mjs`: `buildCommand('agy', …)` gives the exact args, with and without model and effort. `parseLine('agy', …)` handles init, deltas, the final `"\n"` delta, success, an error status and unknown events. `agyHomeFor` and `agyLoginCommand` work on macOS and Windows.
- `bridge/host.test.mjs`: fake `agy` scripts, built the same way as the existing fake CLIs (`#!/usr/bin/env node` scripts in a temp PATH dir), that:
  1. Read stdin, check it is one stream-json `user` line with the draft, check that `HOME` is the agy home and that `.agents/agents/localpolish.md` in the cwd holds the system prompt, then print an init, two deltas and a SUCCESS result. Also create the conversation and brain files under `HOME`, so the test can check that they are deleted afterwards.
  2. Print `Authentication required` to stderr and then hang. The host must answer with the login message quickly and kill it.
  3. Print a result with `status: 'ERROR'`.
  4. Print an init with a bad id such as `../../x`. Nothing outside the agy home is deleted.
- `bridge/install.test.mjs`: agy's folder is added to the wrapper PATH.
- `src/background/providers/cli.test.ts`: `readPong` with and without `agy`, and a bad `agy` value is rejected.
- `src/core/settings.test.ts`: the new defaults.
- e2e: if `tests/e2e/options.spec.ts` or `tests/e2e/action-popup.spec.ts` list the provider cards or picker items, add Antigravity there.

## Do not

- Do not run the real `agy`, any real CLI or a paid provider. Do not touch `~/.gemini`.
- Do not add OpenCode. It is in the backlog.
- Do not add dependencies or change the version. Do not commit. The orchestrator reviews and commits.

## Checks

npm needs `--cache /tmp/npm-cache-localpolish` if it uses a cache.

- Targeted: `npx vitest run bridge src/background src/core src/options src/popup`.
- Full gates once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, `npm run test:e2e`.
- If the sandbox blocks the browser tests, say so in the report. The orchestrator runs them.

## When done

Tick T21c in `docs/plans/features-1.3-1.4.md`, and add: "Live check pending: the owner runs the agy login command, then Claude checks a real Fix and the conversation cleanup."

## Report

List the changed files and the check results. Say how you passed the conversation id to the cleanup, whether output cleanup trims the final newline, and anything in this brief you had to bend and why.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
