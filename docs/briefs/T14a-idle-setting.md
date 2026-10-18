<task>
LocalPolish is a Chrome MV3 extension (WXT, TypeScript strict, Preact, Vitest, Playwright). It has an "idle Fix": when the user pauses typing for 3 s in a message field, the content script runs one Fix in the background and shows a marker. Add a user setting that turns the idle Fix on or off (default on). A toolbar popup with the switch comes in a later task; this task is only the setting and the content script reading it. Every decision is made; do not reopen them.

## Changes

1. `src/core/settings.ts`
   - `interface Settings` (lines ~12-22): add `idleFix: boolean;` between `defaultMode` and `blocklist`.
   - `DEFAULT_SETTINGS` (lines ~24-43): add `idleFix: true,` in the same position.
   - `storedPatch` (lines ~68-80): add `idleFix` to the destructuring next to `defaultMode` so it is not copied through `...rest`, then `if (typeof idleFix === 'boolean') patch.idleFix = idleFix;`. A missing or non-boolean stored value falls back to the default (`true`).
   - Nothing else in this file changes. `isBlocked` stays as it is.
2. `src/entrypoints/content.ts` `start()` (lines ~42-95): `isEnabled` (the blocklist check, lines ~67-68) stays as it is and keeps feeding `createButton`. Add next to it
   ```ts
   const isIdleEnabled = (): boolean =>
     settings !== null && settings.idleFix && !isBlocked(location.hostname, settings.blocklist);
   ```
   and pass `isEnabled: isIdleEnabled` to `createIdleFix` (line ~80) instead of `isEnabled`. So a blocklisted site gets neither the button nor the idle Fix (that is already true today through the shared `isEnabled`; keep it true), and `idleFix: false` stops the idle Fix everywhere. The shortcut and the button keep working when `idleFix` is false. Do not change `src/content/idle.ts`.
3. `src/core/settings.test.ts`: add tests in the existing `describe('loadSettings')`:
   - defaults have `idleFix: true` (the existing "returns defaults" test compares with `DEFAULT_SETTINGS`, so add one explicit `expect(DEFAULT_SETTINGS.idleFix).toBe(true)` or a separate test);
   - a stored `idleFix: false` loads as `false`;
   - a stored `idleFix: 'no'` (not a boolean) loads as `true`.
   And in `describe('saveSettings')`: `saveSettings({ idleFix: false })` then `loadSettings()` gives `idleFix: false` and keeps the other defaults.
4. `tests/e2e/extension.spec.ts` (loads the built extension, real service worker, a mock OpenAI server; you cannot run Chromium in your sandbox, so make the spec typecheck and lint; the orchestrator runs it):
   - Change `writeSettings(sw, openaiBaseUrl, blocklist?)` (lines ~257-272) to `writeSettings(sw, openaiBaseUrl, extra: Record<string, unknown> = {})` that spreads `extra` into the stored settings object. Update its one caller with a blocklist, the test 'blocklist hides the button but the shortcut still opens' (line ~226), to `writeSettings(sw, \`${mock.url}/v1\`, { blocklist: ['localhost'] })`.
   - Add a `test.describe('idle Fix', ...)` at the end of the test list (before the helper functions) with three tests. Each one writes settings, then calls `openFixture(page)` again (as the blocklist test does), clicks `#ta`, types `i has went home today` with `page.keyboard.type`, then:
     - 'a pause sends one Fix and shows the marker' (default settings, `idleFix` not set): `await expect.poll(() => mock.requests.length, { timeout: 10_000 }).toBe(1)` and `await expect(page.locator('.lp-mark')).toBeVisible()`.
     - 'idle Fix off: a pause sends nothing' (`{ idleFix: false }`): `await page.waitForTimeout(4500)`, then `expect(mock.requests).toHaveLength(0)` and `await expect(page.locator('.lp-mark')).toHaveCount(0)`.
     - 'a blocklisted site gets no idle Fix' (`{ blocklist: ['localhost'] }`): same checks as the previous test.
     The file's `beforeEach` (line ~102) already resets `mock.requests` and writes default settings.

## Leave untouched
`src/content/idle.ts`, `src/content/controller.ts`, the options page (`src/options/`), `src/background/`, the other e2e specs, `docs/`.

## Rules
- Write comments only for a non-obvious why. No task IDs in code or comments.
- Do NOT run git add or git commit; leave the work in the working tree. Skip the guard skills and any final review pass; the orchestrator reviews the diff.
</task>

<verification_loop>
While working: `npx vitest run src/core/settings.test.ts`.
At the end, all green: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then `npx prettier --write` on the files you touched and `npx prettier --check .`.
Do not run `npm run test:e2e` (Chromium cannot start in your sandbox); the orchestrator runs it.
</verification_loop>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed, per numbered change above
  2. Files touched
  3. Gate outcomes (paste counts)
  4. Anything you deviated on or want a decision on
</structured_output_contract>
