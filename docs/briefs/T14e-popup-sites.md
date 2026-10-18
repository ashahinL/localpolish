<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup lives in `src/popup/`. `App.tsx` holds `tab` and `host` (`string | null | undefined`: the active tab's hostname, `null` on pages LocalPolish cannot run on, `undefined` while loading). `src/popup/sites.ts` has `hostOf`, `siteState`, `hideSite` and `showSite`, with tests in `sites.test.ts`. The quick switch "Show on {host}" already adds or removes the exact host. Fill the **Sites** tab. Every decision is made; do not reopen them.

The design is `docs/design/popup/popup.html` (`SitesTab()` around lines 507-524 and the CSS section "Sites"). The screenshot is `docs/design/popup/sites-light.png`.

## Changes

1. `src/popup/sites.ts`: add `addSite(input: string, blocklist: string[]): { list: string[] } | { error: string }`, with tests in `sites.test.ts`.
   - Trim and lowercase the input.
   - If it contains `://`, take `new URL(input).hostname`. Otherwise drop everything from the first `/`.
   - Empty, or containing whitespace: `{ error: 'Enter a hostname such as example.com' }`.
   - Already in the list (an entry that, trimmed and lowercased, is equal): `{ error: 'Already in the list' }`.
   - Otherwise `{ list: [...blocklist, host] }`.
   - Tests: `Example.com ` → `example.com`; `https://mail.google.com/mail/u/0` → `mail.google.com`; `news.site.org/path` → `news.site.org`; `''` and `'a b'` → the hostname error; a duplicate with other capitals → `Already in the list`.

2. `src/popup/SitesTab.tsx` (props: `settings`, `host`):
   - `<section class="card stack" aria-labelledby="sites-h">`. Header row: `<h2 id="sites-h">Button hidden on</h2>` and a muted count (`1 site` or `{n} sites`).
   - With entries, `<ul class="sites" aria-labelledby="sites-h">`. Each row has `<span class="host">{entry}</span>`, a `<span class="tag">This tab</span>` when the entry (trimmed, lowercased) equals `host`, and `<button type="button" class="x" aria-label={`Remove ${entry}`}><CloseIcon /></button>`. The button does `change({ blocklist: settings.blocklist.filter((_, i) => i !== index) })`. With no entries, `<p class="empty">No sites yet. The button shows everywhere.</p>`.
   - An add form: `<form class="inline" onSubmit>` with a screen-reader-only `<label for="add-site">Add a site</label>`, `<input id="add-site" placeholder="example.com" autocomplete="off" spellcheck={false}>` and `<button type="submit">Add</button>`. Submit calls `addSite`. On `list`, `change({ blocklist: list })` and clear the input. On `error`, show `<p class="help field-error" role="alert">{error}</p>` under the form until the next input.
   - A help line: `Subdomains are included. The button and the idle Fix stay off on these sites; the shortcut still works.`
   - Below the card, when `host` is a string and `siteState(host, blocklist).kind === 'shown'`: a full-width `<button type="button" class="card site-cta">` with the site letter icon (as in `QuickToggles`), `<b>Hide on {host}</b>` and the help text `Adds this tab's site to the list`. It calls `change({ blocklist: hideSite(host, blocklist) })`.
   - All changes save through `useSettingsApi().change` at once (not as typing). The options page's Sites textarea stays the other editor of the same list.

3. `App.tsx`: render `SitesTab` when `tab === 'sites'`.

4. `src/popup/popup.css`: port the mockup's "Sites" section. Add `.field-error` (color `var(--error)`) and `.site-cta` (left-aligned, `display:flex; gap:10px; align-items:center; height:auto; width:100%`).

## Leave untouched
`QuickToggles.tsx`'s behavior. `src/options/`, `src/core/`, `src/content/`, `src/background/`, `tests/`, `docs/`.

## Rules
- UI matches the mockup screenshot, light and dark. Accessible names on every control. Visible focus rings.
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e`; the orchestrator runs it.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
