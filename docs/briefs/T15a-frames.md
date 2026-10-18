# T15a. Site blocking in every frame, one shortcut handler

Fixes audit A01 and A16 ([audit](../audits/1.0.0.md)). Lane: Sol medium.

## Problem

1. **A01.** The content script runs in every frame (`src/entrypoints/content.ts:26-31`: `allFrames`, `matchAboutBlank`, `matchOriginAsFallback`). The site check at `content.ts:67-70` uses only the frame's own `location.hostname`. So on a blocked site, an editor inside an iframe from another host, or inside an `about:blank` or `srcdoc` frame (hostname `''`), still shows the button and still sends idle Fix requests.
2. **A16.** The shortcut handler at `content.ts:97-105` uses `document.hasFocus()`. A parent document also reports focus when a child frame has it. So the child opens the popup and the parent shows the toast "Click into a text field first." at the same time.

## Steps

1. Add `src/content/site.ts` with one pure function:
   ```ts
   /** The hosts of this frame and every frame above it. Null when a parent's origin is hidden. */
   export function frameHosts(hostname: string, ancestorOrigins: readonly string[]): string[] | null;
   ```
   - Start with `hostname` when it is not `''`.
   - For each entry of `ancestorOrigins`: if it is `'null'` or `new URL(entry)` throws, return `null`. Otherwise add `new URL(entry).hostname`.
   - Chrome hides a parent's origin as `'null'` when the iframe has `referrerpolicy="no-referrer"`. That is why `null` exists.
2. In `content.ts`, replace the two checks at lines 67-70:
   - `const hosts = () => frameHosts(location.hostname, Array.from(location.ancestorOrigins ?? []));`
   - The frame is blocked when `settings.blocklist` is not empty and either `hosts()` is `null` or any host passes `isBlocked(host, settings.blocklist)`.
   - `isEnabled` (the button) and `isIdleEnabled` (idle Fix) both use this. `isIdleEnabled` still also needs `settings.idleFix`.
   - The shortcut (the `onMessage` handler) stays allowed on blocked sites, as today.
3. **Background check for idle requests only.** This is a second wall in case a content script is wrong.
   - In `src/core/messages.ts`, add `trigger?: 'idle'` to `RewriteRequest`.
   - In `src/content/idle.ts:183`, send `{ mode: 'fix', tone: 'polite', text: full, trigger: 'idle' }`.
   - In `src/entrypoints/background.ts`, `isRewriteRequest` accepts `trigger` when it is missing or `'idle'`.
   - Add `sender?: { tab?: { url?: string }; url?: string }` to the `RewritePort` interface. In the `onConnect` handler, after `loadSettings()`, if `request.trigger === 'idle'`, collect the hostnames of `port.sender?.tab?.url` and `port.sender?.url` (skip a URL that does not parse or has an empty hostname). If `settings.idleFix` is false or any of those hosts is blocked, post `{ type: 'error', message: 'LocalPolish is off on this site.' }` and do not call `runRewrite`.
   - The extension has `host_permissions: ['<all_urls>']`, so `sender.tab.url` is filled in.
4. **A16.** In the `onMessage` handler at `content.ts:99`, return early when the deep active element is an `HTMLIFrameElement` or `HTMLFrameElement`. That frame's own content script handles the shortcut. `deepActiveElement()` exists in `src/content/editable.ts:92` but is not exported; export it and use it (also delete the copy at `src/content/button.ts:91` and import the shared one).

## Tests

- **Unit:** `src/content/site.test.ts` for `frameHosts`: no ancestors; two ancestors; `''` own hostname with an ancestor (blank frame); a `'null'` ancestor returns `null`.
- **e2e, real extension:** in `tests/e2e/extension.spec.ts`, next to `test.describe('idle Fix', ...)` at line 263. Use the existing `writeSettings`, `openFixture` and `sendOpenPopup` helpers and `mock.requests`.
  - Add a fixture page `tests/e2e/fixtures/frames.html` with three iframes, each holding a `<textarea>`:
    1. a cross-host iframe: `src="http://127.0.0.1:5179/frame-editor.html"` (add that small page too);
    2. a `srcdoc` iframe;
    3. an `about:blank` iframe that a script fills with a textarea.
  - The Vite fixture server (`tests/e2e/vite.config.ts`) must answer on `127.0.0.1` as well as `localhost`. Set `server.host` so both work, and check that the existing specs still pass.
  - Test "a blocked site gets no idle Fix from its iframes": `writeSettings(sw, url, { blocklist: ['localhost'] })`, open `http://localhost:5179/frames.html`, type `i has went home today` into each frame's textarea (use `page.frameLocator`), wait 4.5 s like the existing blocklist test, and expect `mock.requests` to have length 0 and no `.lp-mark` in any frame.
  - Test "an unblocked page still fixes inside an iframe": no blocklist, type into the cross-host frame, expect one request (poll as in the test at line 264).
  - Test "the shortcut in an iframe opens one popup and no parent toast": focus the cross-host frame's textarea after typing `SOURCE`, send `open-popup` the way `sendOpenPopup` does, expect `.lp-popup` inside the frame, and expect `.lp-toast` count 0 in the top page.
- Keep the existing test "blocklist hides the button but the shortcut still opens" (line 226) passing.

## Done when

- On a blocked site, no idle request leaves from any frame, and no button shows in any frame.
- An unblocked iframe editor still gets idle Fix.
- The shortcut still works on a blocked site, and only the focused frame answers it.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Safer group.
- One commit, message `T15a: <summary>`. Tick T15a in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A01 and A16. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
