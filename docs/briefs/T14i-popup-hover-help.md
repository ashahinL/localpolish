<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). The toolbar popup lives in `src/popup/` and is done. The user wants a quieter popup: three visible subtitle lines move into a hover tooltip that shows only after the pointer rests on the label for 2 seconds. Every decision is made; do not reopen them.

## Changes

1. New `src/popup/Tooltip.tsx`: a small custom tooltip. Do not use the native `title` attribute anywhere for this; it has its own browser delay.
   - API: `<Tooltip id={string} text={ComponentChildren}>{trigger}</Tooltip>`. It renders a wrapper `<span class="tip-wrap">` around the trigger, plus a `<span role="tooltip" id={id} class="tip">` with the text. The tooltip element is always in the DOM, so `aria-describedby` always resolves. It is hidden with a class (`.tip` without `.on` is `visibility: hidden; opacity: 0`), never removed.
   - Show after the pointer rests on the wrapper for `HOVER_DELAY_MS = 2000`, one named, exported constant at the top of the file, so the delay is easy to tweak; use it everywhere, with no other literal for the delay. Start the timer on `pointerenter`, clear it on `pointerleave`, and hide on `pointerleave`. Moving the pointer onto the tooltip itself keeps it open (the tooltip is inside the wrapper).
   - Keyboard: when the trigger or a control inside the wrapper gets focus and it matches `:focus-visible`, show the tooltip at once. Hide it on `focusout` of the wrapper.
   - Escape hides an open tooltip (a `keydown` listener on `document` while it is open), and it stays hidden until the next hover or focus.
   - Clear any timer on unmount.
   - Placement: below the trigger, left-aligned with it, `max-width: 240px`, `z-index` above the tabs. 12px text, `var(--text)` on `var(--card)` with `1px solid var(--border)`, `border-radius: 6px`, `padding: 6px 8px`, a light shadow, `pointer-events: auto`, `white-space: normal`. Works in light and dark through the existing tokens. With `prefers-reduced-motion: no-preference`, fade in over 120 ms.

2. `src/popup/Header.tsx`: remove the visible tagline `<span>Fix and rewrite text in any field</span>`. Wrap the title `<b>LocalPolish</b>` in `Tooltip` (id `brand-tip`, text "Fix and rewrite text in any field"). The `<b>` gets `tabIndex={0}` and `aria-describedby="brand-tip"` so keyboard users can reach the text.

3. `src/popup/QuickToggles.tsx`:
   - Fix while I type row: remove the visible `idle-desc` line. Wrap the `<b id="idle-title">` label in `Tooltip` with id `idle-desc` and the same text it has today ("Fixes a field after a 3 s pause" when on, "Off. The button and the shortcut still work" when off). The switch keeps `descId="idle-desc"`, so it now points at the tooltip.
   - Site row: remove the visible `site-desc` line for the plain-text states: shown ("The button and the idle Fix run here"), hidden ("Hidden here. The shortcut still works") and the unsupported page ("LocalPolish does not run on this page"). Each becomes the tooltip text on the `<b id="site-title">` label, with tooltip id `site-desc`; the switch keeps `descId="site-desc"`.
   - Exception: the hidden-by state keeps its visible line "Hidden by {rule}. Edit in Sites", because it holds a button and explains why the switch is disabled. Keep it as it is, with id `site-desc`, and no tooltip in that state.
   - Keep the `hidden-here` row class; with the subtitle gone, it is fine that the warning color now applies only to the tooltip text.

4. `src/popup/popup.css`: add the `.tip-wrap` (`position: relative; display: inline-block; max-width: 100%`) and `.tip` rules. Remove the rules that only styled the removed subtitles (`.brand span`; keep `.qtxt span` only if the hidden-by line still needs it). The header and quick rows get shorter; keep their padding so they look balanced with one line. Labels keep their ellipsis.

5. Tests.
   - `tests/e2e/action-popup.spec.ts` (written by the previous task) and any other popup test that asserts one of the moved strings as visible text: change those checks to the accessible description of the switch (`await expect(switch).toHaveAccessibleDescription(...)`) or to the tooltip's text, and assert the old subtitle is not visible.
   - Add one test to `action-popup.spec.ts`, "hover help shows after 2 seconds", using Playwright's `page.clock` (install it before the page loads): hover the "Fix while I type" label, run the clock 1900 ms and expect the tooltip hidden, run 100 ms more and expect it visible with "Fixes a field after a 3 s pause"; move the mouse away and expect it hidden; press Tab until the idle switch has focus and expect the tooltip visible at once; press Escape and expect it hidden.
   - Unit tests run in the `node` environment, so add no DOM unit tests. The e2e test uses the literal 1900 and 100 ms steps and does not import from `src/`.

## Leave untouched
`src/options/`, `src/core/`, `src/content/`, `src/background/`, `docs/`, `README.md`. The popup tabs' content.

## Rules
- Accessible names on every control. Visible focus rings. Light and dark.
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff and checks the popup visually.
</task>

<verification_loop>
While working: `npx vitest run src/popup`. If Chromium starts in your sandbox, also run `npx playwright test tests/e2e/action-popup.spec.ts` after `npm run build`; if it does not start, say so and move on.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
The orchestrator runs the full `npm run test:e2e`.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
