<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup lives in `src/popup/`, and its Home, Provider and Sites tabs are done. `App.tsx` holds `tab`. `src/popup/chrome.ts` has `activeTabUrl()` and `openOptionsPage()`, and `icons.tsx` has `ExternalIcon`. Fill the **About** tab and update the README for the popup. Every decision is made; do not reopen them.

The design is `docs/design/popup/popup.html` (`AboutTab()` around lines 525-543, and the CSS section "Shortcut"). The screenshot is `docs/design/popup/about-light.png`.

## Changes

1. `src/popup/chrome.ts`: add `extensionVersion(): string`, which returns `chrome.runtime.getManifest().version`. Extend the local chrome interface for it.

2. `src/popup/AboutTab.tsx` (no props) renders three cards and a footer.
   - Shortcut card, `<section class="card stack" aria-labelledby="sc-h">`. It reads the shortcut the same way as `ShortcutSection` in `src/options/sections.tsx` (lines ~157-195): `polishShortcut()` from `src/options/chrome.ts`, read again on window `focus`, keys from `shortcutKeys()` in `src/options/form.ts`.
     - An `.srow` with `<b id="sc-h">Polish shortcut</b>` and `<span>Select text in a field, then press</span>`, then `<span class="keys" aria-label="Current shortcut">` with one `<kbd>` per key, or `<span class="muted">Not set</span>`.
     - `<button type="button" class="wide-btn">Change shortcut <ExternalIcon /></button>`, which calls `openShortcutsPage()` from `src/options/chrome.ts`.
     - `<p class="help center">Opens chrome://extensions/shortcuts</p>`.
   - Options card: an `.srow` with `<b>All options</b>` and `<span>The full options page, same settings</span>`, then `<button type="button">Open <ExternalIcon /></button>`, which calls `openOptionsPage()`.
   - How it works card: `<h2>How it works</h2>`, then `<p>Select text and press the shortcut, or click the LocalPolish button next to a field. With <b>Fix while I type</b> on, a field is fixed after a 3 s pause and you accept or undo the change.</p>`.
   - Footer: `<p class="foot">LocalPolish {extensionVersion()}</p>`.

3. `App.tsx`: render `AboutTab` when `tab === 'about'`. All four tabs now render.

4. `src/popup/popup.css`: port the mockup's "Shortcut" section, `.foot`, `.wide-btn` (full width, centered icon and text, `gap:6px`) and `.center`.

5. `README.md`. Keep the README's plain, short-sentence style.
   - Step 7 of setup (line ~73): replace it with: "Click the LocalPolish icon in the toolbar (pin it from the puzzle-piece menu). The popup has every setting. Pick a provider on its **Provider** tab, then press **Test connection**. The gear opens the full options page."
   - "Using it" (line ~91): replace the sentence about hiding the button with: "To hide the button on the site you are on, turn off **Show on <site>** in the toolbar popup. This adds the exact hostname to **Sites**. The **Sites** tab, or the options page, edits the whole list. Subdomains of a listed host are included. The idle Fix is off on those sites too. The shortcut still works on them."
   - "Using it": add one paragraph after the shortcut paragraph: "**Fix while I type** is on by default. When you stop typing for 3 seconds in a message field, LocalPolish runs a Fix in the background, and a small marker shows how many fixes it found. Click the marker to see the diff. Turn it off with the **Fix while I type** switch in the toolbar popup."
   - Providers (line ~95), "Choose a provider on the options page": change it to "Choose a provider on the popup's **Provider** tab or on the options page".
   - Line ~107, "You enter keys on the options page": change it to "You enter keys on the **Provider** tab or the options page".
   - Line ~154, "The options page shows the bridge status": change it to "The popup's **Provider** tab and the options page show the bridge status".
   - Do not change the Troubleshooting lines; the options page still works for them.

## Leave untouched
`src/options/`, `src/core/`, `src/content/`, `src/background/`, `tests/`, `docs/`. The other popup tabs.

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
