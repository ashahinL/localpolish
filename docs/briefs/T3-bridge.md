<task>
Build the LocalPolish native messaging bridge in `bridge/`. It is a plain Node ESM program (no build step, no npm deps, Node 18+ built-ins only, JSDoc types are fine). Chrome starts it through native messaging for the extension `ealpmjmaclnlpelpcacmbicmdipmbeei`. It runs one of three AI CLIs (`claude`, `codex`, `grok`) headless with the user's text on stdin and streams the answer back. Tests use Vitest (already configured to include `bridge/**/*.test.mjs`).

Background facts (verified on this Mac, do not re-research):
- Native messaging framing, both directions: 4-byte unsigned length in little-endian, then that many bytes of UTF-8 JSON. Chrome starts a new host process per `connectNative` port and closes the host's stdin when the port disconnects. Anything on stdout that is not a framed message breaks the channel: never use `console.log`. Write diagnostics to stderr only, and never write the user's text or prompts there.
- Chrome starts native hosts with a minimal PATH, so the installer writes a wrapper script with a full PATH.

## Files

### `bridge/constants.mjs`
`export const HOST_NAME = 'com.localpolish.bridge';`
`export const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';`
`export const TIMEOUT_MS = 60_000;`

### `bridge/lib.mjs`
1. `encodeMessage(obj) → Buffer`: 4-byte LE length (byte length of the UTF-8 JSON) + JSON bytes.
2. `createDecoder(onMessage) → (chunk: Buffer) => void`: buffers input, calls `onMessage(parsedObject)` once per complete frame. Must handle a frame split across several chunks and several frames in one chunk.
3. `buildCommand(cli, model, system) → { cmd, args }`. Exact args (omit the model flag and its value when `model` is empty):
   - `claude`: `['-p', '--model', model, '--effort', 'low', '--system-prompt', system, '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--include-partial-messages', '--verbose']`
   - `grok`: `['-p', '-', '-m', model, '--system-prompt-override', system, '--tools', '', '--disable-web-search', '--output-format', 'streaming-messages-json', '--include-partial-messages']`
   - `codex`: `['exec', '-', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', model, '-c', 'model_reasoning_effort=low', '-c', 'developer_instructions=' + JSON.stringify(system), '--json']`
   - `cmd` is the CLI name (`'claude'`, `'grok'`, `'codex'`), resolved through PATH by `spawn`. Unknown cli → throw.
4. `parseLine(cli, line) → { text } | { error } | null`. Trim the line; non-JSON or empty → `null`.
   - `claude` and `grok` (same format): `type === 'stream_event' && event.type === 'content_block_delta' && event.delta.type === 'text_delta'` → `{ text: event.delta.text }`. `type === 'result' && is_error === true` → `{ error: String(result) }`. Everything else (thinking deltas, `assistant` messages, `system` lines, successful `result`) → `null`.
   - `codex`: `type === 'item.completed' && item.type === 'agent_message'` → `{ text: item.text }`. `type === 'turn.failed'` → `{ error: error.message }`. `type === 'error'` → `{ error: message }`. Everything else → `null`.
5. `findOnPath(name, pathEnv) → string | null`: first `dir/name` in `pathEnv.split(':')` that exists and is executable (`fs.accessSync(p, fs.constants.X_OK)`).

### `bridge/host.mjs` (entry point, `#!/usr/bin/env node`)
Reads framed messages from stdin with `createDecoder`. Acts on the first message only:
- `{type:'ping'}`: for each of `claude`, `codex`, `grok`: if `findOnPath(name, process.env.PATH)` finds it, run `<name> --version` (`execFile`, 5 s timeout) and take the first output line trimmed; otherwise `null`. Reply `{type:'pong', clis:{claude:{version}|null, codex:…, grok:…}}`, then exit 0.
- `{type:'rewrite', cli, model, system, user}`:
  1. If `findOnPath(cli, PATH)` is null → reply `{type:'error', message: \`${cli} CLI not found. Install it, log in, then run "npm run bridge:install" again.\`}` and exit.
  2. `fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-'))` as cwd. `spawn(cmd, args, { cwd, env: process.env, stdio: ['pipe','pipe','pipe'] })`. Write `user` to the child's stdin, then end stdin.
  3. Split child stdout into lines (`readline`). For each `parseLine` result: `{text}` → send `{type:'chunk', text}`; `{error}` → remember it.
  4. Keep the last 2000 chars of child stderr.
  5. On child exit: if exit code 0 and no remembered error → send `{type:'done'}`. Else send `{type:'error', message}` where message is the remembered error, or `` `${cli} exited with code ${code}: ${stderrTail.trim().slice(-500)}` ``.
  6. Timeout `TIMEOUT_MS`: kill the child (SIGTERM, then SIGKILL after 2 s), send `{type:'error', message:'Timed out after 60 seconds.'}`.
  7. When the host's own stdin ends (Chrome disconnected): kill the child the same way and exit.
  8. Always remove the temp dir (`fs.rmSync(dir, {recursive:true, force:true})`). Exit only after the last stdout write has flushed (use the write callback).
- Any other message → `{type:'error', message:'Unknown request.'}` and exit.

### `bridge/install.mjs` and `bridge/uninstall.mjs`
- Export `installBridge({ home, repoDir, nodePath, pathEnv }) → { wrapperPath, manifestPath, found: Record<'claude'|'codex'|'grok', string|null> }` from `install.mjs`, and run it with real values when the file is executed directly (`import.meta.url === pathToFileURL(process.argv[1]).href`): `home = os.homedir()`, `repoDir` = the repo root (parent of `bridge/`), `nodePath = process.execPath`, `pathEnv = process.env.PATH`.
- If `process.platform !== 'darwin'` (only in the direct-run path), print an error to stderr and exit 1.
- Steps:
  1. `found[name] = findOnPath(name, pathEnv)` for the three CLIs.
  2. PATH for the wrapper: unique dirs of `nodePath` and every found CLI, in that order, then `/usr/bin:/bin:/usr/sbin:/sbin`.
  3. Write `<home>/Library/Application Support/LocalPolish/localpolish-bridge` (mkdir -p, mode 0o755):
     ```
     #!/bin/sh
     export PATH="<path>"
     exec "<nodePath>" "<repoDir>/bridge/host.mjs"
     ```
  4. Write `<home>/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localpolish.bridge.json` (mkdir -p), 2-space JSON:
     `{ "name": HOST_NAME, "description": "LocalPolish bridge to local AI CLIs", "path": wrapperPath, "type": "stdio", "allowed_origins": ["chrome-extension://" + EXTENSION_ID + "/"] }`
  5. Direct run prints, to stdout, one line per CLI (`claude: /path` or `codex: not found`) and the two written paths.
- `uninstall.mjs`: removes the manifest file and the `LocalPolish` support folder; same direct-run pattern with an exported `uninstallBridge({ home })`.
- Add scripts to `package.json`: `"bridge:install": "node bridge/install.mjs"`, `"bridge:uninstall": "node bridge/uninstall.mjs"`.

## Tests (`bridge/lib.test.mjs`, `bridge/install.test.mjs`, `bridge/host.test.mjs`)

lib:
- encode → decode round trip of `{type:'chunk', text:'مرحبا 👋'}`; the length prefix equals the UTF-8 byte length.
- decoder with one frame split into 3 chunks → one call; two frames in one chunk → two calls in order.
- `buildCommand` exact `args` arrays for each CLI with model `'m1'` and system `'S'`, and with empty model (no `--model` / `-m`).
- `parseLine` with these real recorded lines (trimmed):
  - claude/grok text: `{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"She"}},"session_id":"x"}` → `{text:'She'}`
  - claude/grok thinking: `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}}` → `null`
  - claude result ok: `{"type":"result","subtype":"success","is_error":false,"result":"She doesn't like it."}` → `null`
  - claude result error: `{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Not logged in"}` → `{error:'Not logged in'}`
  - codex answer: `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"She doesn’t like it."}}` → `{text:'She doesn’t like it.'}`
  - codex reasoning: `{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"x"}}` → `null`
  - codex failure: `{"type":"turn.failed","error":{"message":"usage limit reached"}}` → `{error:'usage limit reached'}`
  - `Reading additional input from stdin...` → `null`

install (temp `home` from `fs.mkdtempSync`, a temp bin dir with executable fake `claude` and `grok` files, no `codex`):
- `found` has claude and grok paths, codex `null`.
- wrapper file content exactly matches the expected 3 lines with the bin dir and `nodePath` dir on PATH; mode is executable.
- manifest JSON deep-equals the expected object.
- `uninstallBridge` removes both.

host (spawn `process.execPath bridge/host.mjs` with `env.PATH` = `<fakeBinDir>:<dirname(process.execPath)>:/usr/bin:/bin`; write framed messages to its stdin; decode its stdout):
- Fake `claude` is a Node script (`#!/usr/bin/env node`, chmod 755) that reads all of stdin and prints three `stream_event` text-delta lines: `"echo:"`, then the stdin text, then `"!"`. Send a `rewrite` for cli `claude` with `user:'hello'`. Expect chunks `['echo:', 'hello', '!']` then `{type:'done'}`, and the process exits 0.
- Fake `claude` that writes its pid to a file then sleeps 30 s: send `rewrite`, wait until the pid file exists, end the host's stdin. Host exits within 3 s and the child pid is gone (`process.kill(pid, 0)` throws).
- Fake `claude` that writes `not logged in` to stderr and exits 1 → one `{type:'error'}` whose message contains `not logged in`.
- `rewrite` for `codex` with no codex on PATH → error message contains `codex CLI not found`.
- `ping` with fake `claude` that prints `9.9.9 (Claude Code)` for `--version` → `pong` with `claude.version === '9.9.9 (Claude Code)'`, `codex === null`, `grok === null`.
</task>

<verification_loop>
While working: `npx vitest run bridge`.
Before finishing, all green:
  npm run lint
  npm run typecheck
  npm test
  npm run build
Run `npm run format` once at the end. Do NOT run `npm run bridge:install` for real (it writes into the user's Chrome folder); the orchestrator will.
</verification_loop>

<action_safety>
Only touch `bridge/` and the two new scripts in `package.json`. Do not touch `src/`. Write only comments that explain a non-obvious why. Do NOT run git add or git commit; leave the work uncommitted.
Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on, left open, or want a decision on
  5. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
