# T26d. New look: tokens and shared styles

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact). Release 1.5.0 gives it a new look. This task changes **colors and the shared look of controls only**, on every extension page. Layout changes (moving sections, new buttons, new tabs) come in later tasks. Do not move, add or remove any element.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills and the final review pass. **Do not commit.** The orchestrator reviews and commits.

## The design source

The owner approved this mockup and these notes. Match them exactly:

- `docs/design/redesign/mockup.html` (open it in a browser; the button at the top switches light and dark). Its `<style>` block is the reference for every value below.
- `docs/design/redesign/notes.md`, section "Look".

Do not invent new colors. If a needed color is not in the table below, derive it from these with `color-mix()` and say so in the report.

## Tokens

Rewrite `src/options/tokens.css`. It is loaded first by every page (`src/entrypoints/{popup,options,sidepanel,setup}/main.tsx`). Keep the `color-scheme: light dark` line and the `@media (prefers-color-scheme: dark)` block (the real pages follow the system theme; the mockup's `data-theme` switch is only for the mockup).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#f5f6f9` | `#11141b` | Page background behind sections |
| `--card` | `#ffffff` | `#181c25` | Surfaces: header, sections, inputs (mockup `--surface`) |
| `--text` | `#18213a` | `#e8eaf0` | Body text (mockup `--text` / `--ink`) |
| `--muted` | `#5b6478` | `#a1a9ba` | Secondary text, section headings |
| `--faint` (new) | `#8a92a3` | `#6f788b` | Timestamps and meta only, never body or labels |
| `--border` | `#e3e6ec` | `#272d3a` | Rules between sections, input borders (mockup `--rule`) |
| `--hover` (new) | `#eef0f5` | `#212734` | Hover fill, segmented control track, light buttons |
| `--control` | `#ffffff` | `#181c25` | Input and select background |
| `--control-border` | `#e3e6ec` | `#272d3a` | Input and select border |
| `--accent` | `#18213a` | `#f2d543` | Filled primary buttons, selected radio, on chips (mockup `--primary-bg`) |
| `--accent-text` | `#ffffff` | `#11141b` | Text on `--accent` (mockup `--primary-fg`) |
| `--accent-soft` | `#eef0f5` | `#212734` | Selected-row tint (same as `--hover`) |
| `--mark` (new) | `#ffe45c` | `#f2d543` | Highlighter: active tab mark |
| `--mark-ink` (new) | `#18213a` | `#11141b` | Text on `--mark` |
| `--focus` (new) | `#2f4cc9` | `#8ea6ff` | Focus rings, focused input border |
| `--ok` | `#1f8a4c` | `#4cc488` | Status dot, switch on |
| `--error` | `#c2362b` | `#ef6b5f` | Errors, alert dot |

Keep `--code`, `--ok-soft`, `--ok-border`, `--error-soft`, `--error-border`, `--info-soft` and `--off`, retuned to sit on the new neutrals (derive with `color-mix()` from `--ok`, `--error` and `--card`). The page-local `--warn*`, `--seg`, `--seg-on`, `--shadow` and `--user` at the top of `src/popup/popup.css` and `src/chat/chat.css` stay, retuned the same way: `--seg` = `--hover`, `--seg-on` = `--card` (dark: `--mark`), `--user` = light `#e9ecf4`, dark `#242b3a`.

## Shared looks to apply

Edit `src/popup/popup.css`, `src/chat/chat.css`, `src/options/options.css`, `src/usage/usage.css` and `src/setup/setup.css`. Go through every `var(--accent…)` use (about 45) and decide by role:

1. **Links and text buttons** (for example `.link`, "Change"): `--muted` text, `--text` on hover with a `--hover` fill. Not `--accent`.
2. **Filled primary buttons** (Test connection, Send, Add): `--accent` background, `--accent-text` text, radius 10 px, no border, weight 600. Hover: `filter: brightness(1.12)` in light, `1.05` in dark.
3. **Plain buttons**: `--card` background, `--border` border, radius 8 px, weight 550, `--hover` fill on hover.
4. **Segmented controls** (Default mode, language pills, chat Edit/Preview later): track `--hover`, padding 3 px, radius 10 px; the selected item `--card` with `0 1px 2px rgb(0 0 0 / 0.08)` shadow in light, and `--mark` with `--mark-ink` text in dark. Unselected items `--muted`.
5. **Toolbar popup tabs** (`src/popup/Tabs.tsx` classes): no blue underline. The active tab label gets the highlighter: `background: linear-gradient(transparent 52%, var(--mark) 52%, var(--mark) 92%, transparent 92%)` on the label text only, `--text` color. In dark: no fill, `--mark` text color with `box-shadow: inset 0 -2px 0 var(--mark)`. Inactive tabs `--muted`, `--text` on hover. Keep the provider alert dot, in `--error`.
6. **Switches**: off track `--border`, on track `--ok`, white knob with a small shadow.
7. **Chips and toggle pills that are on** (language pills): `--accent` background and `--accent-text` text.
8. **Focus**: every `:focus-visible` outline is `2px solid var(--focus)` with `outline-offset: 2px`. Focused inputs get `border-color: var(--focus)`.
9. **Section headings** (`h2` in cards, for example "Default mode", "Usage"): sentence case, 13 px, weight 600, `--muted`. Remove `text-transform: uppercase` and letter-spacing wherever it is set.
10. **Cards**: keep the card elements, but make them quieter: `--card` background, 1 px `--border`, no shadow, radius 12 px. (A later task replaces cards with ruled sections; do not do that now.)
11. **Status pills** ("Bridge ready"): a 8 px `--ok` dot and `--muted` text, no tinted pill background.

The logo tile stays as it is in light; in dark it becomes `--mark` with the nib in `--mark-ink`, as in the mockup (`.nib` rules).

Do not change `src/content/ui/popup.css` (the in-page Fix popup on web pages) or any `.tsx` file, except where a class name is missing for a rule above. If you must touch a `.tsx` file, say which and why.

## How to check your work

1. `npm run build`.
2. `npm run shots` renders the toolbar popup tabs to `docs/screenshots/` (Home, Provider, Sites, About, Home dark). Look at every image. Then **restore them** with `git checkout docs/screenshots` (they are retaken in a later task).
3. For the side panel and the options page, open `dist/sidepanel.html` and `dist/options.html` the same way `scripts/shots.mjs` does (route `https://localpolish.test/**` to `dist/`, stub `chrome`), at 400 px wide, in both color schemes, and look at them. Put any helper script and its pictures in `/tmp/t26d/`, not in the repo.
4. Compare each against `docs/design/redesign/mockup.html` in both themes. Colors, buttons, tabs, segments, switches and headings should match. Layout will still differ; that is expected.
5. If Chromium will not start, retry with `--single-process --disable-gpu` in your own script only.

## Gates

Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`, then `npm run test:e2e` (full browser suite, 254 tests). No existing test may be edited. If Chromium cannot start in your sandbox for the browser suite, say so with the exact error; the orchestrator runs it.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26d.` to `- [x]` and set the `Status:` line to `Status: T26a–T26d done. Next: T26e.`

## Report

- Files changed and what changed in each, including the final token values and any derived colors.
- Which `--accent` uses you mapped to which role.
- Screenshots you looked at, and anything that still does not match the mockup apart from layout.
- Gate results with exact commands and counts.
- Any decision this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
