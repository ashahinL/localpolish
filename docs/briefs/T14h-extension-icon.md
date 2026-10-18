<task>
LocalPolish is a Chrome MV3 extension (WXT 0.21, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup lives in `src/popup/` and all four tabs are done. The extension has no icon yet, and the popup header shows a placeholder sparkle (`LogoIcon` in `src/popup/icons.tsx`). Wire in the new icon, and fix one tab hover style. Every decision is made; do not reopen them.

The icon, picked by the user, is a white fountain-pen nib on a rounded-square royal-blue (#2563EB) tile. The files are already in the repo:
- `public/icon/16.png`, `32.png`, `48.png`, `128.png`. This WXT version resolves `publicDir` from the project root, not `srcDir`, so `public/` sits next to `wxt.config.ts`.
- `docs/design/icon/icon.svg` (full design with a sparkle, used for 48 and 128), `icon-medium.svg` (no sparkle, used for 32), `icon-small.svg` (pixel-fitted, used for 16). Do not edit these files or the PNGs.

## Changes

1. `wxt.config.ts`, in `manifest`: add
   - `icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' }`
   - `action: { default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' } }`
   WXT merges the popup entrypoint (`default_popup`, `default_title`) into this `action`; both must survive. Check `dist/manifest.json` after `npm run build`: `icons` has four sizes, and `action` has `default_icon`, `default_popup: "popup.html"` and `default_title: "LocalPolish"`. The four PNGs are in `dist/icon/`.

2. `src/popup/icons.tsx`: replace `LogoIcon` with the medium icon, tile included, as an inline SVG. Copy the shapes exactly from `docs/design/icon/icon-medium.svg`:
   - `viewBox="0 0 128 128"`, `width="28"`, `height="28"`, `aria-hidden="true"`, no stroke.
   - `<rect x="2" y="2" width="124" height="124" rx="28" fill="#2563EB" />`
   - `<path fill="#fff" d="M42 16Q64 11 86 16L80 36Q93 51 97 68Q83 92 64 118Q45 92 31 68Q35 51 48 36Z" />`
   - `<rect x="59" y="42" width="10" height="70" rx="4" fill="#2563EB" />` and `<circle cx="64" cy="66" r="10" fill="#2563EB" />`
   The colors are fixed brand colors, the same in light and dark.

3. `src/popup/popup.css`, `.logo`: the SVG now draws its own tile. Keep `width: 28px`, `height: 28px`, `flex: none` and the grid centering. Remove `background`, `border-radius` and `color`.

4. `src/popup/popup.css`, tabs: hovering a tab must not change its underline, and the selected tab keeps its accent color on hover. Today `button:hover:not(:disabled)` paints every border of a hovered tab `var(--muted)` (a grey underline appears), and `.tab:hover:not(:disabled)` outranks `.tab[aria-selected='true']`, so the selected tab turns `var(--text)` under the mouse. Fix it in the `.tab` rules only: a hovered tab keeps `border-color: transparent` with the bottom border `transparent` (unselected) or `var(--accent)` (selected), and the selected tab's color stays `var(--accent)` on hover.

5. `docs/design/popup/notes.md`: if it mentions the sparkle logo or a placeholder mark, change that sentence to say the header uses the nib icon from `docs/design/icon/`. Change nothing else in it.

## Leave untouched
`public/`, `docs/design/icon/`, `src/options/`, `src/core/`, `src/content/`, `src/background/`, `tests/`. The other popup components, and popup CSS outside `.logo` and the `.tab` rules.

## Rules
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup`, and `npm run build` with a look at `dist/manifest.json`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e`; the orchestrator runs it.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts, and the `icons` and `action` blocks from `dist/manifest.json`)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
