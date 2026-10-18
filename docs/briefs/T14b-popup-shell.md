<task>
LocalPolish is a Chrome MV3 extension (WXT 0.21 with `srcDir: 'src'`, TypeScript strict, Preact, Vitest, Playwright). Today it has an options page (`src/entrypoints/options/` renders `src/options/App.tsx`) and no toolbar popup. Add the toolbar (browser action) popup's shell: the entrypoint, shared design tokens, a header, two switches and four tabs. The tab contents come in later tasks; this task leaves the tab panel empty. Every decision is made; do not reopen them.

The design is a clickable mockup at `docs/design/popup/popup.html` (open it, or read its `<style>` and the `Header()`, `QuickToggles()` and `Tabs()` functions around lines 298-330). `docs/design/popup/home-light.png` and `home-dark.png` show the result. Match it, but build it as Preact components. The mockup's "Mockup controls" panel, its `[data-theme]` selectors and its URL-hash state are mockup-only: do not port them.

## Changes

1. Shared tokens. Create `src/options/tokens.css` and move into it, verbatim, the `:root { ... }` block and the `@media (prefers-color-scheme: dark) { :root { ... } }` block from the top of `src/options/options.css` (lines 1-44). Delete them from `options.css`. In `src/entrypoints/options/main.tsx` import `'../../options/tokens.css'` before `'../../options/options.css'`. The options page must look exactly as before.

2. Entrypoint. WXT turns `src/entrypoints/popup/index.html` into `action.default_popup`, and its `<title>` becomes the action's default title.
   - `src/entrypoints/popup/index.html`: copy `src/entrypoints/options/index.html` without the `manifest.open_in_tab` meta; `<title>LocalPolish</title>`.
   - `src/entrypoints/popup/main.tsx`: `render(<App />, document.getElementById('app')!)` with `App` from `../../popup/App`, and import `'../../options/tokens.css'` and `'../../popup/popup.css'`.
   - After `npm run build`, check that `dist/manifest.json` has `action.default_popup` pointing at `popup.html`.

3. `src/popup/chrome.ts`. Same typed-`chrome` pattern as `src/options/chrome.ts` (a local interface plus an `extension()` getter):
   - `activeTabUrl(): Promise<string | undefined>`: `chrome.tabs.query({ active: true, currentWindow: true })`, returns the first tab's `url`. The manifest's `<all_urls>` host permission makes `url` readable, so no new permission.
   - `openOptionsPage(): void`: `void chrome.runtime.openOptionsPage()`.

4. `src/popup/sites.ts` (pure, no chrome) and `src/popup/sites.test.ts` (Vitest; `vitest.config.ts` already includes `src/**/*.test.ts`):
   - `hostOf(url: string | undefined): string | null`: the URL's `hostname` when the protocol is `http:` or `https:`, else `null` (also `null` for undefined or an invalid URL).
   - `type SiteState = { kind: 'shown' } | { kind: 'hidden' } | { kind: 'hidden-by'; rule: string }`, and `siteState(host: string, blocklist: string[]): SiteState`. `hidden` when an entry, trimmed and lowercased, equals `host`. Otherwise `hidden-by` with the first entry (trimmed) for which `isBlocked(host, [entry])` from `src/core/settings.ts` is true. Otherwise `shown`.
   - `hideSite(host, blocklist): string[]`: appends `host` unless an exact entry is already there (then returns a copy unchanged).
   - `showSite(host, blocklist): string[]`: removes every entry that, trimmed and lowercased, equals `host`. Broader entries stay.
   - Tests: `hostOf` for https, http, `chrome://extensions`, `file:///x`, undefined and `'not a url'`. `siteState` for an exact entry, an exact entry with spaces or capitals, a broader `google.com` entry for `mail.google.com` (`hidden-by`, rule `google.com`), and no entry. `hideSite` adds once and never twice. `showSite` removes the exact entry and keeps `google.com`.

5. Components in `src/popup/`. Use `class` (not `className`) like the options page. Save through the existing `useSettings()` / `SettingsContext` / `useSettingsApi()` from `src/options/useSettings.ts` (`change(patch)` saves at once), unchanged.
   - `icons.tsx`: one small component per icon in the mockup's `ICON` object (lines ~286-294): `LogoIcon`, `GearIcon`, `BoltIcon`, `CheckIcon`, `CloseIcon`, `AlertIcon`, `ExternalIcon`. Keep each SVG's size and `aria-hidden="true"`. Later tasks use the rest.
   - `App.tsx` exports `App`. It calls `useSettings()` and wraps everything in `SettingsContext.Provider`, as `src/options/App.tsx` does. It holds `tab` state (`type TabId = 'home' | 'provider' | 'sites' | 'about'`, start `'home'`) and the active host: `undefined` while loading, then `hostOf(await activeTabUrl())`, or `null` if that throws. Layout: `<div class="popup">` with `Header`, then, once settings have loaded, `QuickToggles` and `Tabs`, then `<main class="panel" id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`} key={tab}>`. The panel is empty in this task. While loading, the panel shows `<p class="muted">Loading…</p>`. On a load error it shows `<p class="note note-error">Could not load settings: {loadError}</p>`, as the options page does.
   - `Header.tsx`: the logo, `LocalPolish` and the tagline `Fix and rewrite text in any field`. Then a `Saved` note (`<span class="saved" role="status">` with `CheckIcon`) that is visible for 1.5 s after each save. Reuse the timing logic of `StatusBadge` in `src/options/App.tsx` (lines ~45-63), with the `status` from `useSettingsApi()`. Last, a gear `<button class="icon-btn" aria-label="Open the full options page" title="All options">` that calls `openOptionsPage()`. When `status.kind === 'error'`, a `<p class="save-error" role="alert">Could not save: {message}</p>` shows under the header (style it like `.note-error`, compact).
   - `Switch.tsx`: `<button type="button" class="switch" role="switch" aria-checked={checked} aria-labelledby={labelId} aria-describedby={descId} disabled={disabled} onClick={onToggle}>`.
   - `QuickToggles.tsx` (props: `settings`, `host: string | null | undefined`, `onOpenSites(): void`). It renders `<section class="quick" aria-label="Quick switches">` with two `.qrow` rows (icon, `.qtxt` with `<b>` title and `<span>` description, `Switch`):
     - Idle row: `BoltIcon` in `.qicon`. The title is `Fix while I type`. The description is `Fixes a field after a 3 s pause` when on, and `Off. The button and the shortcut still work` when off. The switch toggles `change({ idleFix: !settings.idleFix })`. `idleFix` is a boolean in `Settings` (`src/core/settings.ts`).
     - Site row: `.qicon.site` shows the first letter of the host without a leading `www.`, uppercased. Its states:
       - host `undefined`: title `This site`, no description, switch disabled and off.
       - host `null`: title `This page`, description `LocalPolish does not run on this page`, switch disabled and off.
       - `shown`: title `Show on {host}`, description `The button and the idle Fix run here`, switch on. Clicking it does `change({ blocklist: hideSite(host, settings.blocklist) })`.
       - `hidden`: the row gets class `hidden-here`, description `Hidden here. The shortcut still works`, switch off. Clicking it does `change({ blocklist: showSite(host, settings.blocklist) })`.
       - `hidden-by`: description `Hidden by {rule}.` followed by a `<button type="button" class="link">Edit in Sites</button>` that calls `onOpenSites()`. The switch is off and disabled.
     `App` passes `onOpenSites={() => setTab('sites')}`.
   - `Tabs.tsx` (props: `active: TabId`, `onChange(tab: TabId): void`). It renders `<nav class="tabs" role="tablist" aria-label="Popup sections">` with buttons for Home, Provider, Sites and About: `role="tab" id={`tab-${id}`} aria-controls="panel" aria-selected tabIndex={active ? 0 : -1}`, class `tab`. ArrowLeft and ArrowRight (wrapping), Home and End move the selection, activate the new tab and focus it.

6. `src/popup/popup.css`: port from the mockup's `<style>` these sections:
   - "Popup frame", "Controls", "Header", "Quick toggles strip", "Switch", "Tabs", "Cards" (lines ~56-122).
   - The popup-only tokens `--warn`, `--warn-soft`, `--warn-border`, `--seg`, `--seg-on` and `--shadow`: light values in a `:root` block, dark values in one `@media (prefers-color-scheme: dark) { :root { ... } }` block. Skip `--later-*` and every `[data-theme]` rule.
   - Add `html, body { margin: 0; }` and `body { width: 360px; height: 600px; overflow: hidden; background: var(--bg); color: var(--text); font-family/size/line-height as the mockup's body }`. Chrome sizes a popup from its body.
   - The shared controls from `src/options/controls.tsx` (used in later tasks) render `.field`, `.inline`, `.help`, `.note`, `.note-ok`, `.note-error`, `.code-line`, `button.copy`, `button.secondary`. Keep those class names available. The mockup's "Notes" and "Fields" sections are ported in the next tasks.

## Leave untouched
Everything under `src/options/` except moving the tokens out of `options.css`. `src/core/settings.ts`, which already has `idleFix`. `src/content/`, `src/background/`, `tests/`, `docs/`.

## Rules
- UI matches the mockup: spacing, sizes, colors, light and dark through `prefers-color-scheme`. Accessible names on every control. Visible focus rings (`:focus-visible` with `--accent`).
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (then check `dist/manifest.json` has `action.default_popup`), then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e` (Chromium cannot start in your sandbox); the orchestrator runs it.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts), and the `action` block of `dist/manifest.json`
  4. Anything you deviated on or want a decision on
</structured_output_contract>
