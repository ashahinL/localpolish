<task>
Build the background service worker of the LocalPolish Chrome extension (WXT + TypeScript strict + Vitest). It receives rewrite requests from the content script, builds the prompt, calls the chosen provider, streams text back, and cleans the final output.

Already in the repo, use as-is (do not change them):
- `src/core/settings.ts`: `Settings`, `ProviderId`, `Mode`, `Tone`, `loadSettings()`.
- `src/core/prompts.ts`: `buildPrompt(mode, tone, text) → {system, user}`.
- `src/core/cleanup.ts`: `cleanOutput(raw, input)`.
- `bridge/constants.mjs`: `HOST_NAME = 'com.localpolish.bridge'`. Do not import from `bridge/` in `src/`; repeat the constant in `src/core/messages.ts`.
- Bridge protocol (one native port per request): send `{type:'rewrite', cli:'claude'|'codex'|'grok', model, system, user}`; receive `{type:'chunk', text}` many times, then `{type:'done'}` or `{type:'error', message}`. Send `{type:'ping'}`; receive `{type:'pong', clis:{claude:{version}|null, codex:{version}|null, grok:{version}|null}}`.

## Files

### `src/core/messages.ts`
```ts
export const HOST_NAME = 'com.localpolish.bridge';
export const REWRITE_PORT = 'rewrite';
export interface RewriteRequest { mode: Mode; tone: Tone; text: string }
export type RewriteEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };
export type BridgeStatus = { ok: true; clis: Record<'claude'|'codex'|'grok', { version: string } | null> } | { ok: false; message: string };
export type TestResult = { ok: true; sample: string; ms: number } | { ok: false; message: string };
export type RuntimeMessage = { type: 'test-connection' } | { type: 'bridge-status' } | { type: 'open-popup' };
```

### `src/background/providers/types.ts`
```ts
export interface PromptPair { system: string; user: string }
export type StreamFn = (prompt: PromptPair, settings: Settings, onText: (t: string) => void, signal: AbortSignal) => Promise<void>;
```
A `StreamFn` resolves when the answer is complete and rejects with an `Error` whose `message` is user-readable.

### `src/background/providers/cli.ts`
- `export function cliProvider(cli: 'claude'|'codex'|'grok'): StreamFn`. Opens `chrome.runtime.connectNative(HOST_NAME)`, posts the `rewrite` message with `model: settings.models[<provider id>]`, calls `onText` per chunk, resolves on `done`, rejects on `error`. On `signal` abort: `port.disconnect()` and reject with `new Error('Cancelled.')`.
- `port.onDisconnect` before `done`/`error`: read `chrome.runtime.lastError?.message`. If it contains `not found` → reject `'The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install'`. Otherwise reject with `'The bridge stopped: ' + message` (or `'The bridge stopped unexpectedly.'`).
- `export function pingBridge(): Promise<BridgeStatus>` with the same not-installed mapping and a 10 s timeout.
- Provider id mapping: `claude-cli`→`claude`, `codex-cli`→`codex`, `grok-cli`→`grok`.

### `src/background/sse.ts`
`export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }>`. Decode with `TextDecoder` (stream mode). Events end at a blank line. Handle `\r\n` and `\n`, `event:` and `data:` fields (strip one leading space after the colon), several `data:` lines joined with `\n`, comment lines starting with `:`, and an event split across chunks. Skip events with no data.

### `src/background/providers/openai.ts`
`export const openaiProvider: StreamFn`.
- If `settings.models['openai-compatible']` is empty → reject `'Set a model name for the OpenAI-compatible provider in LocalPolish settings.'`
- `POST ${settings.openaiBaseUrl.replace(/\/+$/, '')}/chat/completions`, headers `content-type: application/json` and, only when `openaiApiKey` is set, `authorization: Bearer <key>`. Body: `{ model, temperature, stream: true, messages: [{role:'system', content: system}, {role:'user', content: user}] }`. Pass `signal`.
- Non-OK response → reject `` `HTTP ${status}: ${(await res.text()).slice(0, 300)}` ``. If status is 403 and the base URL contains `:11434`, append `' Ollama blocks unknown origins: set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.'`
- Stream: for each SSE event, `data === '[DONE]'` → stop; else `JSON.parse(data).choices?.[0]?.delta?.content` → `onText` when it is a non-empty string.
- `fetch` failure (TypeError) → reject `` `Cannot reach ${baseUrl}. Is the server running?` ``.

### `src/background/providers/anthropic.ts`
`export const anthropicProvider: StreamFn`.
- Empty `anthropicApiKey` → reject `'Add your Anthropic API key in LocalPolish settings.'`
- `POST https://api.anthropic.com/v1/messages`, headers: `content-type: application/json`, `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. Body: `{ model: settings.models['anthropic-api'], max_tokens: 4096, temperature, system, stream: true, messages: [{ role: 'user', content: user }] }`.
- Non-OK → reject `` `HTTP ${status}: ${(await res.text()).slice(0, 300)}` ``.
- Stream: event data with `type === 'content_block_delta' && delta.type === 'text_delta'` → `onText(delta.text)`; `type === 'error'` → reject with `error.message`; `type === 'message_stop'` → stop.

### `src/background/providers/index.ts`
`export function getProvider(id: ProviderId): StreamFn` mapping the five ids.

### `src/background/rewrite.ts`
```ts
export async function runRewrite(req: RewriteRequest, settings: Settings, stream: StreamFn, post: (e: RewriteEvent) => void, signal: AbortSignal): Promise<void>
```
Builds the prompt with `buildPrompt`, accumulates raw text while posting each piece as `{type:'chunk'}`, then posts `{type:'done', text: cleanOutput(raw, req.text)}`. On rejection posts `{type:'error', message: err.message}` (unless `signal.aborted`, then post nothing). If the cleaned text is empty, post `{type:'error', message:'The model returned an empty answer. Try again.'}`.

`export async function testConnection(settings, stream): Promise<TestResult>`: runs `runRewrite` with `{mode:'fix', tone:'polite', text:'this are a test sentence'}` and a 45 s timeout; returns `{ok:true, sample, ms}` or `{ok:false, message}`.

### `src/entrypoints/background.ts`
Inside `defineBackground`:
1. `chrome.runtime.onConnect`: for ports named `REWRITE_PORT`, on the first message load settings, pick `getProvider(settings.provider)`, create an `AbortController`, call `runRewrite` with `post` wrapping `port.postMessage` in try/catch (the port may be gone). `port.onDisconnect` aborts the controller.
2. `chrome.runtime.onMessage`: `test-connection` → `testConnection(await loadSettings(), getProvider(...))`; `bridge-status` → `pingBridge()`. Reply with `sendResponse` and `return true` for async.
3. `chrome.commands.onCommand`: for `'polish'`, query the active tab in the current window and `chrome.tabs.sendMessage(tab.id, {type:'open-popup'})`; ignore the rejection (pages without the content script).
Never log API keys, prompts or user text. No `console.log` calls at all.

## Tests (Vitest, `src/background/**/*.test.ts`)
Build `fetch` responses with `new Response(new ReadableStream(...))` that enqueue SSE text in uneven chunks; stub `globalThis.fetch` with `vi.fn`.
- `sse.test.ts`: event split across 3 chunks; `\r\n` line endings; two `data:` lines joined; comment lines skipped; `event:` field captured.
- `openai.test.ts`: streams `"I "`, `"went."` then `[DONE]` → `onText` called with those; request URL `http://localhost:11434/v1/chat/completions` when base URL has a trailing slash; `authorization` header absent without a key and present with one; 401 → message starts `HTTP 401:`; 403 on `:11434` → message contains `OLLAMA_ORIGINS`; empty model → the settings message; fetch throwing `TypeError` → `Cannot reach`.
- `anthropic.test.ts`: text deltas streamed; headers include `x-api-key` and `anthropic-dangerous-direct-browser-access: true`; body `system` and `messages` match; `error` event → rejects with its message; empty key → settings message.
- `cli.test.ts`: fake `globalThis.chrome.runtime.connectNative` returning a fake port (`postMessage` spy, `onMessage`/`onDisconnect` with `addListener` that stores callbacks, `disconnect` spy). Assert the posted `rewrite` message (cli, model from settings, system, user); chunks reach `onText`; `done` resolves; `error` rejects with its message; disconnect with `lastError.message = 'Specified native messaging host not found.'` → the not-installed message; abort → `disconnect` called and rejects `'Cancelled.'`.
- `rewrite.test.ts`: with a fake `StreamFn` that emits `'Here is the text:\n'`, `'I went home.'` → posts two chunks then `{type:'done', text:'I went home.'}`; a rejecting `StreamFn` → `{type:'error'}`; aborted signal → no error posted; empty answer → the empty-answer error.
</task>

<verification_loop>
While working: `npx vitest run src/background`.
Before finishing, all green:
  npm run lint
  npm run typecheck
  npm test
  npm run build
Run `npm run format` once at the end.
</verification_loop>

<action_safety>
Only touch `src/background/`, `src/core/messages.ts` and `src/entrypoints/background.ts`. Do not edit other `src/core/` files or `bridge/`. Write only comments that explain a non-obvious why. Do NOT run git add or git commit; leave the work uncommitted.
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
