# T26h. Options page restyle

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 gives every extension page a new look. The toolbar popup (T26g) and the side panel (T26e, T26f) are done. This task restyles the **options page** (`options.html`) to the same look. **Same sections, same order, same controls, no behavior changes.**

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits.

## Design source

- `docs/design/redesign/mockup.html` has no options frame. Use its look, as the popup now does: read the mockup's popup CSS (about lines 70–180) and the real popup (`src/popup/popup.css`, `docs/screenshots/*.png`) as the reference for the same parts.
- `docs/design/redesign/notes.md`, section "Look": navy ink, yellow highlighter, sections separated by thin rules instead of stacked cards, system fonts, and "The options page gets the same tokens and look."
- Tokens are in `src/options/tokens.css` (T26d). No new colors.

## Files

- `src/options/options.css` (476 lines): the main work.
- `src/options/App.tsx` (66), `sections.tsx` (235), `ProviderSection.tsx` (254), `controls.tsx` (192): class names and wrapper elements only, where the CSS needs them. Keep every heading text, label, `aria-*`, role, input type and help text.
- `src/usage/UsageSection.tsx` / `src/usage/usage.css`: only if the Usage section needs a class to match.

`src/options/ProviderSection.tsx` exports `CliDetails`, `OpenAiDetails`, `AnthropicDetails`, and `src/options/sections.tsx` exports `LANGUAGES`; the popup reuses them. The popup loads `popup.css`, not `options.css`, so CSS here does not reach it, but **class names in those shared components must not change** (the popup styles them). Add classes instead of renaming. After your change, `npm run shots` must produce the same popup pictures as before (check with `git diff --stat docs/screenshots`; restore them with `git checkout docs/screenshots` if only the timestamp-free bytes differ, and report if anything visibly changed).

## Layout

1. A centered column, max width about 680 px, 24 px side padding (16 px under 480 px wide), `--bg` page background.
2. Page head: the logo tile (as in the popup header, `LogoIcon` from `src/popup/icons.tsx`) and the `LocalPolish` wordmark, with the tagline under it in `--muted`. Keep the `h1`. The `Saved` / `Could not save` status keeps its behavior and roles; place it at the right of the head, styled like the popup's `Saved` indicator and its save-error line.
3. Sections: replace the card look with ruled sections, as in the popup: `--card` surface for the column, each section separated by a 1 px `--border` rule, 20–24 px padding, section headings (`h2`) 13–14 px, weight 600, `--muted`, sentence case. Keep each section's `h2` text.
4. **AI provider**: a radio list like the popup's Provider tab (`.prov` rows with the `.radio` circle, name in weight 550), keeping today's visible subtitle under each title in `--muted`. Keep the native radio inputs and their labels exactly (`role="radiogroup"`, `aria-label="AI provider"`).
5. Controls: inputs and selects like the popup's (8 px radius, `--control` background, `--control-border`, `--focus` border on focus); primary buttons filled `--accent`; plain buttons as in the popup; switches, chips (language toggles) and segmented controls (default mode) as in the popup; `kbd` keys as in the popup's More tab.
6. Bridge section: status as a dot plus text (no tinted pill), the CLI list as ruled rows, the setup command block in `--code` with the existing copy button.
7. Notes (`note`, `note-error`, `note-ok`) keep their meaning, restyled to the T26d soft tones.
8. Dark mode follows the system (`prefers-color-scheme`), as today.
9. Arabic: the page has no Arabic text of its own; inputs with user text keep `dir="auto"` where they have it.

## How to check your work

1. `npm run build`.
2. Render `dist/options.html` with a stubbed `chrome` (the T26g helper `/tmp/t26g/shots.mjs` shows how pages are routed and stubbed; write yours in `/tmp/t26h/`, not in the repo). Look at 1280 px and 400 px wide, light and dark, with each provider selected (a CLI provider with the bridge OK, with the bridge missing, the OpenAI-compatible and the Anthropic sections), a test result, and a save error.
3. No horizontal scroll at 400 px (`tests/e2e/options.spec.ts` checks section overflow; keep it passing).
4. If Chromium will not start, retry with `--single-process --disable-gpu` in your own script only.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. Then try `npm run test:e2e`; the delegate sandbox has blocked port 5179 before (`listen EPERM`). If so, run `npx playwright test tests/e2e/options.spec.ts tests/e2e/action-popup.spec.ts` with a config that skips the web server if you can, report the exact results, and stop. No existing test may be edited.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26h.` to `- [x]` and set the `Status:` line to `Status: T26a–T26h done. Next: T26i.` Do not edit the Handoff section.

## Report

- Files changed and what changed in each (class names added, any wrapper elements added).
- Screenshots you looked at (paths in `/tmp/t26h/`) and anything that still looks off.
- Whether the popup screenshots changed.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
