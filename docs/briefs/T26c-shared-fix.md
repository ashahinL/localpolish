# T26c. Shared Fix wiring and shortcut routing

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest, Playwright). Release 1.5.0 adds "documents": a text area in the side panel (`sidepanel.html`) that must get the same Fix behavior as a text field on a web page. A spike proved the existing Fix factories (`createController`, `createIdleFix`, `createButton`) work unchanged in the side panel. This task makes that wiring reusable and adds the side-panel entry point. **No UI** here: the document editor that mounts it comes in a later task.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. **Do not commit.** The orchestrator reviews and commits.

## Hard rule

Behavior on web pages must not change at all. The full browser suite (`npm run test:e2e`) must pass with **no edits to existing tests**.

## Steps

### 1. New `src/content/fix.ts`

Move the Fix part of `start()` in `src/entrypoints/content.ts` (the `connect`/`controller`/`idle`/`button` setup, lines about 82–125, and the body of the `open-popup` branch, lines about 140–147) into one exported function:

```ts
export interface FixDeps {
  connect(): PortLike;
  settings(): PageSettings | null; // null until loaded
  isEnabled(): boolean; // floating button
  isIdleEnabled(): boolean; // Fix while I type
  detect: DetectFn;
  isMac: boolean;
  accepts?(el: HTMLElement): boolean; // which fields Fix may act on; default: all
}

export interface FixHandle {
  refresh(): void; // calls idle.refresh() and button.refresh()
  openFromShortcut(): void; // what the open-popup message does today
}

export function startFix(deps: FixDeps): FixHandle;
```

- `getSettings`, `languages` and `isFixDefault` read `deps.settings() ?? DEFAULT_SETTINGS`, exactly as `start()` does now.
- `openFromShortcut()` contains today's code unchanged: return unless `document.hasFocus()`; return if the deep active element is an iframe or frame; `captureTarget({ wholeFieldIfEmpty: true })`; open it, or show the toast `Type some text first.` / `Click into a text field first.`. Add one thing: if `deps.accepts` is set and the focused editable (`focusedEditable()`) is not accepted, show `Click into a text field first.` and stop.
- `accepts` must also gate the other two paths:
  - `src/content/idle.ts`: add optional `accepts?(el: HTMLElement): boolean` to `IdleDeps` (line 20). In `onInput` (line 93) and `tryRun` (line 174), treat a field that `accepts` rejects like one where `isIdleField` is false.
  - `src/content/button.ts`: add optional `accepts?(el: HTMLElement): boolean` to `ButtonDeps`. In `wantedField()` (line 23), return `null` when the selected field is not accepted.
  - Pass `deps.accepts` through from `startFix`. When it is undefined, nothing changes.

### 2. `src/entrypoints/content.ts` uses it

`start()` keeps its settings loading (`applySettings`, the `page-settings` request, `settingsGeneration`), `hosts`, `isEnabled`, `isIdleEnabled`, `createChatInsert`, `createSelectionChat` and the `runtime.onMessage` listener. It calls `startFix({ connect, settings: () => settings, isEnabled, isIdleEnabled, detect: (text) => ext.i18n.detectLanguage(text), isMac })` with no `accepts`. `applySettings` calls `fix.refresh()` instead of `idle?.refresh(); button?.refresh();`. The `open-popup` branch becomes `if (isOpenPopup(message)) fix.openFromShortcut();`. Keep the comment about WXT and the type-only import.

### 3. New `src/chat/documentFix.ts` (the side-panel entry, not mounted yet)

```ts
export async function startDocumentFix(accepts: (el: HTMLElement) => boolean): Promise<() => void>;
```

It returns a stop function that removes its listeners. Steps inside:

1. Load settings first: `pageSettings((await chrome.storage.local.get('settings')).settings)` (`pageSettings` from `src/core/settings.ts`). The spike found `createIdleFix` must not start before settings exist.
2. `startFix` with: `connect = () => chrome.runtime.connect({ name: REWRITE_PORT })`; `isEnabled = () => true` (site hiding does not apply to documents); `isIdleEnabled = () => settings.idleFix`; `detect = (text) => chrome.i18n.detectLanguage(text)`; `isMac = /Mac|iPhone|iPad/.test(navigator.platform)`; the given `accepts`.
3. `onSettingsChanged` (from `src/options/chrome.ts`): reload settings the same way, then `fix.refresh()`.
4. `chrome.runtime.onMessage` listener: on `{ type: 'open-popup' }` call `fix.openFromShortcut()`. Return nothing (no reply).
5. A `keydown` listener on `document` (capture phase): read the shortcut once with `polishShortcut()` from `src/options/chrome.ts` (it returns the `polish` command's shortcut string, `''` if unset). When `matchesShortcut(shortcut, event)` is true, `preventDefault()` and call `fix.openFromShortcut()`.

Note: `createController`, `createIdleFix` and `createButton` add their own document listeners and have no stop function. That is fine: the stop function removes only the listeners this file adds (settings, message, keydown). Say so in a short comment.

### 4. New `src/chat/shortcut.ts` with a pure matcher

```ts
export function matchesShortcut(
  shortcut: string,
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
): boolean;
```

`chrome.commands.getAll()` gives shortcuts in two formats: Windows/Linux `Ctrl+Shift+K`, `Alt+Shift+L`; macOS symbols with no separator, `⇧⌘K`, `⌥⇧L`, `⌃⇧K`. Map: `Ctrl` → `ctrlKey`, `Command`/`⌘` → `metaKey`, `MacCtrl`/`⌃` → `ctrlKey`, `Alt`/`⌥` → `altKey`, `Shift`/`⇧` → `shiftKey`. The last part is the key; compare it to `event.key` case-insensitively. Every modifier must match exactly (no extra modifiers). An empty string never matches.

Tests `src/chat/shortcut.test.ts`, literal cases: `Ctrl+Shift+K` matches ctrl+shift+`K`, and also `k`; fails with an extra alt; fails without shift. `⇧⌘K` matches meta+shift+`k`; fails with ctrl instead of meta. `⌥⇧L` matches alt+shift+`L`. `⌃⇧K` matches ctrl+shift+`K`. `''` never matches.

### 5. Background routing (`src/entrypoints/background.ts`)

1. The `polish` command handler (about line 405): keep sending `open-popup` to the active tab. Also call `extension().runtime.sendMessage({ type: 'open-popup' })` and swallow its rejection (no extension page may be listening). Do this before the tab query, not inside it.
2. The idle check in the rewrite port (about lines 343–357): when `isPanelSender(port.sender)` (line 179) is true, skip the blocklist part. `settings.idleFix` still applies. So: `if (!settings.idleFix || (!isPanelSender(port.sender) && hosts.some(...)))`.

Tests in `src/background/entrypoint.test.ts`, next to the tests at lines 278–304 and using the same `connect(sender)` helper. The side-panel sender shape is the `PANEL` constant at line 989 (`{ id: 'localpolish', url: 'chrome-extension://localpolish/sidepanel.html' }`); define it above your tests or move it up:
- An idle request from the panel runs even when the blocklist contains `localpolish` (mock `loadSettings` with that blocklist, expect `runRewrite` called once).
- An idle request from the panel is rejected with `LocalPolish is off on this site.` when `idleFix` is false.
- The `polish` command sends `{ type: 'open-popup' }` with `runtime.sendMessage` and still sends it to the active tab. Capture the command listener from the `commands.onCommand.addListener` mock (line 66). Add `sendMessage` to `runtime` in the stub if it is not there.

## Gates

While working: `npx vitest run src/chat/shortcut.test.ts src/background/entrypoint.test.ts src/content/idle.test.ts`.
Once at the end, in this order: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`, then `npm run test:e2e` (full browser suite; it builds first). If Chromium cannot start in your sandbox, say so in the report with the exact error; do not change `launchExtension()` or the Playwright config.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26c.` to `- [x]` and set the `Status:` line to `Status: T26a, T26b and T26c done. Next: T26d.`

## Out of scope

No UI. Do not mount `startDocumentFix` anywhere yet. Do not change `src/content/ui/**`, `src/content/editable.ts` or any existing e2e test.

## Report

- Files changed and what each change is.
- Gate results with the exact commands and pass/fail counts, including the browser suite.
- Any decision you had to make that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
