<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup lives in `src/popup/`. `App.tsx` holds `tab` and the hooks `useBridge()` (`src/popup/useBridge.ts`) and `useTest()` (`src/popup/useTest.ts`). The Home tab is done. It uses `BridgeErrorNote.tsx`, `TestConnection.tsx` and `summary.ts`. `PROVIDERS` and `isCli` are exported from `src/options/ProviderSection.tsx`. Fill the **Provider** tab with all five provider forms, by reusing the options page's form components. Every decision is made; do not reopen them.

The design is `docs/design/popup/popup.html`: the `ProviderPicker()`, `ProviderDetails()`, `BridgeCard()` and `ProviderTab()` functions around lines 420-506, and the CSS sections "Provider picker", "Fields" and "Bridge list". The screenshots are `docs/design/popup/provider-claude-light.png`, `provider-codex-light.png`, `provider-grok-light.png`, `provider-custom-model-light.png`, `provider-openai-light.png`, `provider-anthropic-light.png`, `provider-dark.png` and `bridge-error-provider-light.png`.

## Changes

1. Reuse the forms. In `src/options/ProviderSection.tsx`, add `export` to `CliDetails` (line ~75), `OpenAiDetails` (line ~111) and `AnthropicDetails` (line ~152). In `src/options/sections.tsx`, add `export` to `CLIS` (line ~9). Change nothing else in `src/options/`. Do not fork them: the popup must show exactly the same fields and behavior as the options page (presets plus `Custom…`, API key Show/Hide, temperature number field, Ollama and Codex notes). The mockup's temperature slider is dropped; the shared number field stays.

2. `src/popup/ProviderPicker.tsx` (props: `settings`):
   - `<section class="card" aria-labelledby="pp-h">` with an sr-only `<h2 id="pp-h">AI provider</h2>`, then `<div role="radiogroup" aria-labelledby="pp-h">`.
   - Group label `<p class="pgroup-label">Your subscription · via the bridge</p>` and `<div class="chips">` with claude-cli, codex-cli and grok-cli.
   - Group label `API` and `<div class="chips two">` with openai-compatible and anthropic-api.
   - Each choice is a native radio, like the options page's `.provider` cards: `<label class={selected ? 'chip selected' : 'chip'}><input type="radio" name="provider" value={id} checked onChange={() => change({ provider: id })} />{title}</label>`. The titles come from `providerSummary()`'s `title` rule (OpenAI-compatible shortened) or the same mapping.
   - Under the groups, `<p class="psub">{PROVIDERS subtitle}</p>`.
   - CSS: a hidden input, `.chip.selected` styled like the mockup's `.chip[aria-checked=true]`, and the focus ring on `.chip:has(input:focus-visible)`. No check icon.

3. `src/popup/BridgeCard.tsx` (props: `bridge` from `useBridge`). Render it only for CLI providers.
   - `<section class="card stack" aria-labelledby="br-h" aria-busy={checking}>`.
   - Header row: `<h2 id="br-h">Bridge</h2>` and `<button type="button" class="link">Check again</button>` (disabled while checking) → `check()`.
   - `status === null`: `<p class="muted">Checking…</p>`.
   - `!ok`: `BridgeErrorNote` with the message.
   - `ok`: `<ul class="clis">` with one row per `CLIS` entry: a dot (`dot on` or `dot off`), the name, and the version or `not found`. Same as `BridgeSection` in `sections.tsx`.

4. `src/popup/ProviderTab.tsx` (props: `settings`, `bridge`, `test`), in this order:
   - `ProviderPicker`;
   - `<section class="card stack" id="details" aria-labelledby="pd-h">` with `<h2 id="pd-h">{title} settings</h2>`, then `<div class="details" key={provider}>` holding `CliDetails` (for CLI providers, with `provider` and `settings`), `OpenAiDetails` or `AnthropicDetails`;
   - `BridgeCard` for CLI providers;
   - `<section class="card stack" aria-labelledby="tc-h">` with `<h2 id="tc-h">Test connection</h2>`, `<p class="help">Runs a tiny Fix with {title}.</p>` and `<TestConnection test={test} wide />`.

5. Tabs attention dot. Give `Tabs` an optional prop `alert?: TabId`. That tab's button gets `<span class="bad" aria-hidden="true" />` after its label, plus a `<span class="sr">, needs attention</span>` (add a `.sr` visually-hidden class if there is none). `App` passes `alert="provider"` when `isCli(settings.provider) && bridge.status?.ok === false`.

6. `App.tsx`: render `ProviderTab` when `tab === 'provider'`.

7. `src/popup/popup.css`, so the shared options controls fit 360 px:
   - port the "Provider picker", "Fields" and "Bridge list" sections;
   - in the popup, `.details` is a flex column with `gap: 10px` (no top border, unlike the options page);
   - `.row` (from `CliDetails`) is `grid-template-columns: 1.45fr 1fr; gap: 10px; align-items: start`;
   - `.field label` is `font-weight:500; font-size:13px`;
   - `.inline` is `display:flex; gap:6px` with children `flex:1 1 0; min-width:0` and buttons `flex:none`;
   - a `PresetPicker` in `Custom…` mode renders `<div class="inline"><select/><input/></div>`. In the popup, stack those two: `.inline:has(> select + input) { flex-direction: column; }`;
   - `input`, `select`, `textarea` and the buttons get the heights from the mockup's "Controls" section, if the previous task did not already add them;
   - `.note` code lines must not overflow: `CodeLine` already ellipsizes through `.code-line code`.

## Leave untouched
`src/options/` except the four `export` keywords. `src/core/`, `src/content/`, `src/background/`, `tests/`, `docs/`. The Home tab, except what the shared CSS needs.

## Rules
- UI matches the mockup screenshots, light and dark. Accessible names on every control. Visible focus rings.
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup src/options`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e`; the orchestrator runs it (the options page e2e must still pass, so do not change its markup).
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
