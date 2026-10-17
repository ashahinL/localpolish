<task>
Scaffold "LocalPolish", a Chrome Manifest V3 extension, in the current folder (/Users/ashahin/code/projects/web/AI-Companion). The folder is a git repo that holds only docs/ and .gitignore. Build tool: WXT (latest stable) with TypeScript strict, Preact for UI, Vitest, ESLint (flat config with typescript-eslint), Prettier. Package manager: npm.

Do exactly this:

1. `package.json`: name `localpolish`, `"type": "module"`, private. Scripts:
   - `dev`: `wxt`
   - `build`: `wxt build`
   - `typecheck`: `wxt prepare && tsc --noEmit`
   - `lint`: `eslint .`
   - `format`: `prettier --write .`
   - `test`: `vitest run`
   - `postinstall`: `wxt prepare`
   Runtime deps: `preact`, `diff`. Dev deps: `wxt`, `typescript`, `@preact/preset-vite`, `vitest`, `eslint`, `typescript-eslint`, `@eslint/js`, `globals`, `prettier`, `eslint-config-prettier`, `@types/chrome` if WXT does not already provide chrome types, `@types/diff` if `diff` has no bundled types.

2. `wxt.config.ts`:
   - `srcDir: 'src'`, `outDir: 'dist'`. Make `npm run build` put the loadable extension directly in `dist/` (so `dist/manifest.json` exists). Use WXT's `outDirTemplate` option set so no `chrome-mv3` subfolder is created. If your WXT version cannot do that, leave the default `dist/chrome-mv3/` and say so in the report.
   - Preact via `vite: () => ({ plugins: [preact()] })` from `@preact/preset-vite`.
   - `manifest`:
     - `name: 'LocalPolish'`, `description: 'Private writing assistant: fix and rephrase text in any field using your own AI subscriptions.'`
     - `key`: the exact string below (it pins the extension ID to ealpmjmaclnlpelpcacmbicmdipmbeei):
       `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoyrMQ5xUDqTXT2eIU4bzerK4IF6mT8P3vU/hHWVsE+3iIHZwvNCe/E/rgjRYpiddQBK+iKbxvVsN+NsJQJA3Lq35LnKMSf3ZQIMS6epCsGjnXZJ+PGF4Ak1udIe7eBeZ1qe63zo/fzKFUJ+jgUFEab49vpkhssWhvsMw7g2AoLBZ2xcnuW77J3ujaWWoIQnCQuCX9qPoTwEhujjKTC2OJvDM0CAdq9/uOGTTbleCEFlIce2hm8ffEXFIdMOkhLdVa7f4/pa1pBZIAnq5egzmLLWrpEpFv2UgeSMzpcihEagoErndkTudeKeHp+pKHJU9X/rKldWhv63x+FRA5KK0EwIDAQAB`
     - `permissions: ['storage', 'nativeMessaging']`
     - `host_permissions: ['<all_urls>']`
     - `commands: { polish: { suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' }, description: 'Polish the selected text' } }`

3. Entrypoints under `src/entrypoints/` (placeholders only, no features):
   - `background.ts`: `export default defineBackground(() => {})`.
   - `content.ts`: `defineContentScript({ matches: ['<all_urls>'], allFrames: true, runAt: 'document_idle', main() {} })`.
   - `options/index.html` + `options/main.tsx`: renders a Preact `<h1>LocalPolish settings</h1>` into `#app`. Set `<meta name="manifest.open_in_tab" content="true" />` so the options page opens in a tab.
   - Create empty folders by adding the real files later; do not add `.gitkeep` files.

4. `tsconfig.json` extends `./.wxt/tsconfig.json`, `strict: true`, `jsx: 'react-jsx'`, `jsxImportSource: 'preact'`.

5. `eslint.config.js` (flat): `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-config-prettier`. Globals: browser + node + webextensions. Ignore `dist/`, `.output/`, `.wxt/`, `node_modules/`, `coverage/`, `playwright-report/`, `test-results/`.

6. `.prettierrc.json`: `{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }`. `.prettierignore`: same folders as the ESLint ignores plus `package-lock.json`.

7. `vitest.config.ts`: environment `node`, include `src/**/*.test.ts` and `bridge/**/*.test.mjs`. Add one smoke test `src/core/smoke.test.ts` asserting `1 + 1 === 2` only so `npm test` has something to run; it will be deleted in the next task.

8. `npm install`, then run the gates below until all pass. Run `npm run format` once at the end.

Leave untouched: `docs/`, `.gitignore` (except adding a line if WXT needs a new generated folder ignored).
</task>

<verification_loop>
Run and make green before finishing:
  npm run lint
  npm run typecheck
  npm test
  npm run build
Then check `dist/manifest.json` (or `dist/chrome-mv3/manifest.json`) contains `"key"`, `"nativeMessaging"`, the `polish` command and a content script for `<all_urls>`. Paste the manifest into your report.
</verification_loop>

<action_safety>
Keep changes scoped to this scaffold. No feature code. Do NOT run git add or git commit; the orchestrator commits after review. Leave the work uncommitted in the working tree.
Follow the implement-plan skill in its light form: build, test, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass; the orchestrator reviews the diff.
</action_safety>

<structured_output_contract>
End with a report in this exact shape:
  1. What changed and why
  2. Files touched
  3. Gate outcomes (paste lint/typecheck/test/build results)
  4. The built manifest.json and its path
  5. Anything you deviated on, left open, or want a decision on
  6. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
</structured_output_contract>
