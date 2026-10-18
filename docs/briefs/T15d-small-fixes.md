# T15d. Small privacy and output fixes

Fixes audit A03, A06, A12, A13 and A14 ([audit](../audits/1.0.0.md)). Lane: Sol medium. Five separate small fixes, one commit. Each one is a few lines plus tests.

## 1. A03: inherited spellcheck

- **Problem:** `isIdleField()` in `src/content/editable.ts:53` checks only the element's own attribute: `el.getAttribute('spellcheck') === 'false'`. A textarea inside `<div spellcheck="false">` has `spellcheck === false` in Chromium, but still gets idle Fix. `PRIVACY.md:48-50` promises that fields with spellcheck off are skipped.
- **Fix:** use the effective property: `if (!el.spellcheck) return false;`.
- **Tests:** unit tests run in Node with no DOM, so test this in the browser. In `tests/e2e/fixtures/index.html`, add a `<div spellcheck="false">` holding a textarea `#ta-nospell`, and a `<div spellcheck="false">` holding a textarea `#ta-spell-on` with `spellcheck="true"`. In `tests/e2e/popup.spec.ts`, inside `test.describe('idle fix', ...)` (line 344), use its `startIdle`, `pause` and `requests` helpers: typing four words in `#ta-nospell` sends no request; typing in `#ta-spell-on` sends one. Check that the Draft.js fixture, which turns spellcheck on (see `tests/e2e/fixtures/main.js:138`), still gets idle Fix.

## 2. A06: exact loopback check

- **Problem:** `isLoopbackHost()` in `src/background/providers/openai.ts:7-14` accepts any hostname that starts with `127.`, so `http://127.audit.invalid/v1` gets the API key over plain HTTP.
- **Fix:** the hostname comes from `new URL()`, which already turns IPv4 forms such as `127.1` into `127.0.0.1`. Accept only:
  - `localhost` and names ending in `.localhost`;
  - `[::1]`;
  - an IPv4 literal that matches `/^127(\.\d{1,3}){3}$/`.
  Also, when a key is set, throw for any protocol other than `http:` and `https:`, with the message `The base URL must start with http:// or https://.`
- **Tests:** in `src/background/providers/openai.test.ts`, next to "refuses to send an API key to a remote http server" (line 255) and "sends an API key to loopback over http" (line 295): `http://127.audit.invalid/v1` with a key throws and `fetch` is never called; `http://127.0.0.1:1234/v1` and `http://[::1]:1234/v1` with a key still call `fetch`; `ftp://localhost/v1` with a key throws. Keyless `http://192.168.1.5/v1` still works (the test at line 317 covers a remote host already).

## 3. A12: a filtered stream must not become an answer

- **Problem:** in `openaiProvider`, the loop at `openai.ts:79-95` returns on `[DONE]` before it looks at how the stream ended. A chunk with `finish_reason: 'content_filter'` followed by `[DONE]` becomes a normal answer, and Accept is enabled on partial text.
- **Fix:** remember any `finish_reason` that is not `null`, `'stop'` or `'length'` (`length` already throws). On `content_filter`, throw `The provider blocked this answer.` On any other unknown reason, throw `The answer ended early (<reason>). Try again.` Keep these working: a stream with `stop` and `[DONE]`; a stream with `[DONE]` and no finish reason at all (some local servers do this); a stream with `stop` and no `[DONE]` (test at line 237).
- **Tests:** in `openai.test.ts`, model them on "rejects a stream cut off at the length limit" (line 166): `content_filter` then `[DONE]` rejects with the new message; an unknown reason rejects; `[DONE]` with no finish reason at all still resolves with the text.

## 4. A13: keep text tags the user wrote

- **Problem:** `stripTextTags()` in `src/core/cleanup.ts:23-28` removes a `<text>…</text>` wrapper even when the user's own text was exactly that. `cleanOutput('<text>hello</text>', '<text>hello</text>')` returns `hello`.
- **Fix:** pass `input` to `stripTextTags`, and skip the strip when `input.trim()` already starts with `<text>` and ends with `</text>`. The fence check in `stripFence()` (line 31) already works this way, so match it.
- **Tests:** in `src/core/cleanup.test.ts`, next to "removes text tags" (line 19): an unchanged `<text>hello</text>` input stays as it is; a model wrapper around a normal sentence is still removed.

## 5. A14: whole emoji sequences

- **Problem:** `emojiRe()` in `src/core/tokens.ts:22-24` matches `\p{Extended_Pictographic}` only. Flags (regional indicator pairs) are not matched at all, and a skin-tone change is missed: `findMissingTokens('hi 👍🏽 🇪🇬', 'hi 👍')` returns `[]`.
- **Fix:** match full emoji sequences with `new RegExp('\\p{RGI_Emoji}', 'gv')`. Use the `RegExp` constructor so the TypeScript target does not need to change. No new package. Chrome and Node 22+ support the `v` flag.
- **Tests:** in `src/core/tokens.test.ts`, next to "reports an emoji that was dropped" (line 43):
  - a dropped `🇪🇬` is reported;
  - `👍🏽` changed to `👍` is reported;
  - a dropped family `👨‍👩‍👧` is reported, and a dropped keycap `1️⃣` is reported;
  - the same emoji kept is not reported;
  - plain text such as `#1`, `(c) 2026` and digits produces no emoji token.
  Keep the existing hashtag and mention tests passing.

## Done when

- The five test groups above pass, and every existing test still passes.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Safer and Fixes groups.
- One commit, message `T15d: <summary>`. Tick T15d in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for each of A03, A06, A12, A13 and A14. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
