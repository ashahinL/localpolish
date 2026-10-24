# T26g. Toolbar popup layout

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 gives the toolbar popup a new layout. The color tokens and shared control looks are done (T26d, `src/options/tokens.css`, `src/popup/popup.css`). The side panel already handles documents (T26e, T26f). This task rebuilds the popup's layout to match the approved mockup, adds **New chat**, **New document** and recent documents, and retakes the screenshots.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits.

No other behavior changes: every setting the popup edits today stays editable in the same way.

## Design source

- `docs/design/redesign/mockup.html`: the "Toolbar popup, 400 × 600" frame (markup about lines 249–395, CSS about lines 70–180). Switch its tabs and its light / dark button to see every pane. Copy its icons. Token mapping: `--surface` → `--card`, `--rule` → `--border`, `--ink` → `--text`, `--primary-bg` → `--accent`, `--primary-fg` → `--accent-text`, `--err` → `--error`. No new colors.
- `docs/design/redesign/notes.md`, sections "Look" and "Popup". Each line there is the owner's decision.
- Sections are separated by thin rules (`.sec` with a bottom border), not cards. Replace the popup's `card` look with ruled sections as you go.

## Files

`src/popup/App.tsx` (86 lines), `Header.tsx`, `HomeTab.tsx` (143), `Tabs.tsx` (56), `QuickToggles.tsx` (129), `SitesTab.tsx` (113), `ProviderPicker.tsx` (69), `ProviderTab.tsx` (51), `BridgeCard.tsx`, `TestConnection.tsx`, `AboutTab.tsx` (65, becomes `MoreTab.tsx`), `chrome.ts`, `chrome.test.ts`, `icons.tsx` (224), `popup.css` (1140); `src/usage/UsageSection.tsx` only if it needs a class; `scripts/shots.mjs` (101); `tests/e2e/action-popup.spec.ts` (802); `README.md` (screenshot table only, lines 20–28). A new small helper `src/core/when.ts` with `when.test.ts` (section 6).

Do not change `src/options/**` behavior (the popup reuses `CliDetails`, `OpenAiDetails`, `AnthropicDetails`, `LANGUAGES` and `useSettingsApi` from there), `src/chat/**` except `History.tsx` (section 6), `src/content/**` or the background.

## 1. Top of the popup (`App.tsx`, `Header.tsx`, new hero)

1. Header as in the mockup's `.p-head`: the logo, the `LocalPolish` wordmark (keep its tooltip), the `Saved` indicator, and the gear `icon-btn` (keep `aria-label="Open the full options page"`). Keep the save-error line under it.
2. `QuickToggles` is **no longer** rendered above the tabs (it moves to Sites, section 4).
3. A `.hero` block under the header, before the tabs:
   - `.starts`: **New chat** (filled `.new-chat`, chat-bubble icon) and **New document** (`.new-chat.alt`, document icon). Both are disabled until the chat target loads, exactly like today's **Open chat** button (`OpenChat` in `HomeTab.tsx`), and show the same errors under the buttons (`role="alert"`). Move that logic into the hero; the old Open chat button goes away.
   - **New chat** calls `openPlainChat(target)`. **New document** calls `openPlainChat(target, { kind: 'document' })`.
   - `.using` line: a status dot (`--ok` for tone ok, `--error` for error, `--faint` for neutral, from `connection(settings, bridge.status)` in `summary.ts`), then `<b>` provider title and the muted detail from `providerSummary(settings)` (keep today's detail text, for example `GPT-6 Luna · Effort: None`; ellipsis when long), then **Change** (`.text-btn`, goes to the Provider tab) and **Test** (`.text-btn`, visible text `Test`, `aria-label="Test connection"`, runs the same `test.run`).
   - Under the line: the connection label as small text in the tone's color (`Bridge ready`, `Checking…`, and so on), then, when a test runs or has a result, the same `Testing…` / `Works. Got “…” in … s` / `Test failed` output as `TestConnection` shows today, and `BridgeErrorNote` when a CLI provider's bridge check failed (as Home shows it today). Keep it compact; nothing here may push the tabs below about 260 px at 400 × 600 when there is no test result.
4. `chrome.ts`: `openPlainChat(target, entry?: { kind: 'document'; documentId?: string })`. It sends `{ type: 'chat-open-plain', ...target }` for chat (unchanged) and adds `kind: 'document'` and, when given, `documentId` for documents. Keep `sidePanel.open` as the first call, before any `await`, and `window.close()` on success. Update `chrome.test.ts` with the document cases. The background already accepts these keys (`src/background/chatEntries.ts`).

## 2. Tabs (`Tabs.tsx`)

Home, Provider, Sites, **More** (`TabId` `'more'` replaces `'about'`). Keyboard behavior unchanged. The highlighter tab look from T26d stays; check it against the mockup. Keep the provider alert dot.

## 3. Home (`HomeTab.tsx`)

1. **Recent documents** section (`h2` "Recent documents"): the 3 newest from `listDocuments()` in `src/core/documents.ts`. Each row is a button (`.recent`) with `title || 'Untitled'` (`dir="auto"`, ellipsis) and the short time from section 6. Clicking calls `openPlainChat(target, { kind: 'document', documentId: id })` and shows errors like New chat does. When there are none: `p.help` "No documents yet. New document starts one." Load errors: `p.help` "Could not load documents."
2. **Button and shortcut do** section: the Fix / Rephrase / Shorter control and its help line, same behavior (`defaultMode`). Keep the radio inputs (`role="radiogroup"`) and restyle as the mockup's `.seg`.
3. The Using card, Default mode card, Open chat and Usage leave Home (Using moved to the hero, Usage moves to More).

## 4. Sites (`SitesTab.tsx`, `QuickToggles.tsx`)

1. First section: today's `QuickToggles` content, restyled as the mockup's `.row`s: the site row first (keep its names, for example `Show on mail.google.com`, the tooltips, `Hidden by … Edit in Sites`, and the disabled cases), then **Fix while I type** with its switch and, when on, the language chips under it (keep `aria-label="Languages to fix while I type"`, each chip's `aria-label` and `aria-pressed`; style as the mockup's `.chip`). Drop the bolt and site-letter icons if they do not fit the mockup rows.
2. Second section: the hidden-sites list as today (heading, count, `This tab` tag, remove buttons, add form, errors), restyled as the mockup's `.site-list` and `.add`. Heading: `Hidden on N sites` (`1 site`, `N sites`; `No sites hidden` when empty, keeping today's empty text).
3. `onOpenSites` (the "Edit in Sites" link) now just scrolls the hidden-sites section into view and focuses the add field, since the user is already on Sites.

## 5. Provider (`ProviderPicker.tsx`, `ProviderTab.tsx`) and More (`MoreTab.tsx`)

1. Provider list as the mockup's `.prov-list`: two group labels (`Your subscription, through the bridge` and `API key`), one row per provider with the `.radio` circle, the name, and on CLI rows the found version in `.meta` when the bridge status lists it (look at how `BridgeCard` reads the CLI list; show nothing when unknown). **Keep native radio inputs** (visually hidden) inside each row's `<label>`, so `role="radio"` names stay `Claude Code`, `Codex`, `Anthropic API` and so on. Keep the subtitle line under the list.
2. Then the provider's details (`ProviderDetails`), headed `<Provider> for Fix` as in the mockup, then for CLI providers the bridge section (`BridgeCard` content: status, CLI list `.clis li`, **Check again**), then the Test connection section. Keep every control, label and help text inside them.
3. More: rows like the mockup: **Polish shortcut** with the `kbd` keys (keep `aria-label="Current shortcut"`), **Change shortcut** (row text "Opens Chrome's shortcut settings"; its button opens `openShortcutsPage`), **All options** (row text "The full settings page"; button opens `openOptionsPage`). Then the `UsageSection` (keep its region name `Usage`), then the version line `LocalPolish <version>`. The "How it works" paragraph goes away.

## 6. Short times (`src/core/when.ts`)

`shortWhen(timestamp: number, now = Date.now()): string`, in the `Africa/Cairo` time zone: same day → `12:40` (24-hour, `HH:MM`); the day before → `Yesterday`; 2 to 6 days before → short weekday (`Mon`); older → `Oct 3`. Unit tests in `when.test.ts` with fixed timestamps, including a case across midnight Cairo time. Use it for the popup's recent documents **and** for the side panel history rows (`src/chat/History.tsx`, replace its `WHEN.format(...)`).

## 7. Icons (`src/popup/icons.tsx`)

The old icons use camelCase SVG props (`strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `fillRule`, `clipRule` and similar). Preact without compat writes those names as-is, so the browser ignores them and the icons draw with 1 px lines. Change them to the dashed attribute names (`stroke-width`, …), as the T26e icons already do. Check every icon still looks right afterwards.

## 8. Browser tests (`tests/e2e/action-popup.spec.ts`)

The tests stub `chrome` inside `openPopup` (about line 55). You may:

1. Update locators for things this task renames or moves, and only those: `Open chat` → `New chat`; the `About` tab → `More`; Usage now on More (click the More tab first); quick switches now on Sites (click Sites first); anything whose accessible name changed because the brief says so. Keep every assertion's meaning. List each changed test in the report.
2. Extend the `openPopup` stub with an optional `documents` array returned by `chrome.storage.local.get('documents')`, and record the `chat-open-plain` message (the stub already records `chat-pending`; also keep the message body so a test can read `kind` and `documentId`).
3. Add tests:
   - New document sends `chat-open-plain` with `kind: 'document'` and no `documentId`, and closes like New chat.
   - Home lists only the 3 newest of 4 stored documents, an empty title shows `Untitled`, and clicking one sends `kind: 'document'` with its `documentId`.
   - No documents shows the empty text.
   - The Test button in the hero runs a test and shows the result (reuse how existing Test connection tests drive the test port).
4. If the popup layout tests check sizes or overflow (for example no horizontal scroll at 400 px), keep them passing with the new layout.

## 9. Screenshots

Update `scripts/shots.mjs`: tabs Home, Provider, Sites, More, and Home dark; stub 3 documents (one Arabic title) so Home shows recent documents. Write `more.png` instead of `about.png` and delete `docs/screenshots/about.png`. Run `npm run shots` and keep the new pictures. In `README.md`, change only the screenshot table: `about.png` → `more.png`, alt text `More tab`, caption `More`. (The rest of the README is T26i.)

## How to check your work

1. `npm run build`, then `npm run shots`. Look at every picture.
2. Also render the popup at 400 × 600 in light and dark with: an error bridge status for a CLI provider, a test result showing, and a long model detail. Put any helper and pictures in `/tmp/t26g/`, not in the repo.
3. Compare each pane against the mockup in both themes.
4. If Chromium will not start, retry with `--single-process --disable-gpu` in your own script only.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. Then try `npm run test:e2e`. The delegate sandbox has blocked port 5179 before (`listen EPERM`); if so, report the exact error and stop. The orchestrator runs it. Note: `expect.poll` does not retry when its callback throws, so read nested values with `?.`.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26g.` to `- [x]` and set the `Status:` line to `Status: T26a–T26g done. Next: T26h.` Do not edit the Handoff section.

## Report

- Files changed and what changed in each.
- Every edit to existing tests, by test name, and the new tests.
- Screenshots you looked at and anything that still does not match the mockup.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
