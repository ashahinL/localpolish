# LocalPolish popup: Option A (tabs), final mockup

Open `popup.html` in a browser. A "Mockup controls" panel sits to the right of the 360×600 popup and sets theme, tab, provider, bridge, test and this-site state. It is hidden when the window is 360px wide, so screenshots show only the popup. The same state can be set from the URL hash, e.g. `#tab=provider&provider=grok-cli&theme=dark&bridge=error&test=fail&site=off`. The PNGs in this folder were rendered from it at 360×600 (2×).

## Layout (top to bottom, always visible)
1. **Header**: logo, name and tagline, a "Saved" note that shows for 1.5 s (as on the options page), and a gear button that opens the full options page.
2. **Quick switches**: *Fix while I type* (idle Fix) and *Show on <current host>*. When the site toggle is off, the row turns amber and says "Hidden here. The shortcut still works".
3. **Tabs**: Home · Provider · Sites · About. Provider gets a red dot when the bridge is missing and a CLI provider is selected.

## Tabs
- **Home**: a "Using" card with provider, model and effort, a status pill (Bridge ready / No bridge / Key saved / No API key / Local server), a Change link, and Test connection with its running, success and failure states. If the bridge is missing, the error note with the `npm run bridge:install` copy line appears here. Below that: the default mode as a Fix / Rephrase / Shorter switch with one line of help, then Usage today (dashed border, "Later · example data").
- **Provider**: the picker has two groups of choices: *Your subscription · via the bridge* (Claude Code, Codex, Grok CLI) and *API* (OpenAI-compatible, Anthropic API). The picked provider's description shows under them. Below it is that provider's settings card:
  - CLI providers: Model and Thinking effort pickers, with the presets from `presets.ts` plus "Custom…", which shows a text field under the dropdown. Codex also shows its login command.
  - OpenAI-compatible: Base URL presets plus Custom, the Ollama origins note, Model (its placeholder follows the preset), API key with Show/Hide, and Temperature as a slider plus a number field.
  - Anthropic: Model presets, API key with Show/Hide, Temperature.
  - Then the Bridge card (CLI providers only: CLI list with versions, Check again, or the not-installed note), then Test connection.
- **Sites**: the existing `blocklist` as rows with remove buttons and an Add field. The current host is tagged "This tab". When the current site isn't hidden, a "Hide on <host>" shortcut button shows under the list.
- **About**: the shortcut shown as keys, a Change shortcut button (opens `chrome://extensions/shortcuts`), an "All options" link, a short How it works, and the version.

## Mapping to Preact (`src/entrypoints/popup`)
`PopupApp` → `Header`, `QuickToggles`, `Tabs`, then `HomeTab` (`StatusCard`, `TestConnection`, `DefaultModeCard`, `UsageCard`), `ProviderTab` (`ProviderPicker`, `ProviderDetails`, `BridgeCard`, `TestConnection`), `SitesTab` (`SitesCard`), `AboutTab` (`ShortcutCard`, `OptionsLinkCard`). Every element carries a matching `data-component`. `PresetPicker`, `SecretInput`, `CodeLine`/`CopyButton` and `Note` can come straight from `src/options/controls.tsx`. Only the styling changes: the custom input goes under the dropdown, not beside it. Saving can reuse `useSettings` / `SettingsContext` unchanged.

## Accessibility
Switches are `<button role="switch" aria-checked>` with a label and description. The tabs, provider picker and mode switch are `tablist` / `radiogroup` with roving tabindex and arrow keys. Every control has a label (some screen-reader-only). Error notes use `role="alert"`, the test and saved messages use `role="status"`. Focus rings use `--accent`. Text colours are the options.css tokens.

## Assumptions (open questions settled with defaults)
1. **Idle Fix is on by default.** It needs a new `idleFix: boolean` setting (default `true`) in `Settings` / `DEFAULT_SETTINGS`, and `idle.ts` `isEnabled()` would read it.
2. **The site toggle adds the exact hostname** of the active tab (`mail.google.com`, not `google.com`) to the existing `blocklist`, and turning it back on removes that entry. If a broader rule such as `google.com` is what hides the site, turning it back on would need to say so. That edge case isn't designed yet.
3. **What a hidden site means** stays as today: the button is hidden and the shortcut still works. I assumed the idle Fix is also off there (the row text says "Button and idle Fix on this site"). Please confirm.
4. **The full options page stays** and is linked from the gear and from About.
5. Temperature is one shared value for both API providers, as in `Settings`, and is shown only for them.
6. The current tab's host would come from `chrome.tabs.query({active:true,currentWindow:true})`, which needs the `activeTab` permission. On `chrome://` pages and other pages it can't read, the site row would be hidden or disabled (not mocked).
7. Usage stats are a placeholder only. The numbers are sample data.

## Sample values (not from `DEFAULT_SETTINGS`)
Current tab `mail.google.com`. Blocklist `docs.google.com`, `notion.so` (the default is empty). CLI versions 2.3.4 and 0.98.0, and Grok CLI "not found". The Anthropic key is a fake so Show/Hide has something to reveal. The test reply and its 1.4 s are invented, and the failure text is the real "Timed out after 45 seconds." from `rewrite.ts`. The version is 0.0.0 from `package.json`.

## Still open
- Should "Fix while I type" also be switchable per site, or is the blocklist enough?
- Should the default mode stay on Home or move to Provider? It's on Home because it's a frequent, small control.
- Shortcut on macOS: `shortcutKeys()` already splits "⇧⌘K" into keys. Not mocked.
