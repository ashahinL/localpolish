# Changelog

Each version here is one that has a tag and a GitHub release. What is
finished but not released yet waits under Unreleased. How a version ships:
[RELEASING.md](RELEASING.md).

## Unreleased

**Safer**

- Content scripts cannot read local storage and receive only site, idle Fix, and default mode settings, keeping API keys in trusted extension contexts (F03).

- Privacy policy explains the tab-memory cache, API key destinations, idle exclusions, and Grok history and X-search limits (A17).

- A02: Settings changes now remove idle markers and cancel automatic work immediately. Blocking a site also hides its selection button, while manual rewrites keep working.

- A01: Blocked sites now keep the button and idle Fix off in child frames, with a second site check for idle requests in the background.
- A16: Only the focused frame handles the shortcut, so parent frames no longer show an extra toast.

- Idle Fix skips fields that inherit spellcheck off and honors an explicit spellcheck on (A03).
- API keys over HTTP require a real loopback hostname and cannot use other protocols (A06).

- Bridge cancellation kills resistant descendants before the host exits (A07).
- The macOS bridge wrapper treats shell-special characters in paths literally (A08).

**Fixes**

- Sites labels now cover both the button and Fix while I type.

- Accept stops before pasting if the selection moves to another editor or the selected text changes during the wait (A04).
- Accept detects changed paragraph splits and rejects ignored line-break rewrites (A05).

- Blocked or unexpectedly ended provider streams fail instead of enabling Accept for partial text (A12).
- Output cleanup keeps text tags that the input already has (A13).
- Missing-emoji warnings cover flags, skin tones, families, and keycaps as whole sequences (A14).

- Concurrent settings writes from extension pages preserve independent changes (A09).
- Damaged stored settings use checked defaults rather than crashing (A11).
- Site entries share one hostname normalizer, and options identifies invalid entries (A15).

- Failed settings saves stay pending, and Test connection waits for a successful save (A10).
- The full options page includes the Fix while I type checkbox (A18).

**For contributors**

- Release guide rebases before tagging, explains bridge updates and version rules, and deletes only merged branches (A22).
- Old benchmark pages now identify their date and point to the current default and Fix prompt.

- Run macOS and Windows bridge tests and Node 22 checks on manual dispatch and `v*` tags (A20).

- Override Draft.js's test-only Immutable dependency to 3.8.4; both dependency audits are clean (A19).

- Audit of 1.0.0 with confirmed findings and evidence, a review of it, and the next-release plan with one brief per task. No runtime changes.

## 1.0.0 — 2026-10-18

The first release, as a zip on GitHub to load unpacked in Chrome.

**Rewrite**

- Fix, Rephrase or Shorter for any text field: select text and click the
  round button under it, or press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>
  (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> off macOS). With nothing
  selected, the shortcut takes the whole field.
- Rephrase in five tones: Keep tone, Polite, Formal, Casual and Angry but
  civil.
- The answer streams in as a word diff. Accept, Copy or Retry; the site's own
  Undo brings the old text back.
- Warnings when a rewrite drops a link, @mention, #hashtag, code or emoji, or
  changes Arabic script, and a character count with a 280 warning on Shorter.
- Works in plain fields and in Gmail, X, LinkedIn and GitHub editors. When a
  site ignores the new text, it is copied for you to paste.

**Fix while I type**

- On by default. After a 3-second pause in a message box, a Fix runs in the
  background and a marker counts the fixes; click it for the diff.
- Skips single-line inputs, search boxes, code editors, fields with
  spellcheck off, and text under four words.

**Toolbar popup**

- Every setting in the toolbar popup, behind the new pen nib icon:
  **Fix while I type** and **Show on** _this site_ on top, then the Home,
  Provider, Sites and About tabs.
- Home shows the provider in use with a status pill, Test connection, and the
  default mode.
- Sites lists where the button and Fix while I type stay off, with one-click
  Hide on for the current tab. The shortcut still works there.
- Hold the pointer on a label for 2 seconds for a line of help.
- Light and dark, following the system. The full options page stays, behind
  the gear.

**Providers**

- Claude Code, Codex and Grok CLI on your own subscriptions, through a
  native-messaging bridge that runs them with their tools off.
- Any OpenAI-compatible API (OpenAI, xAI, OpenRouter, LM Studio, Ollama) and
  the Anthropic API.
- Model and thinking effort presets per provider, plus Custom. Codex with
  `gpt-6-luna` is the default, the best scorer on the Fix benchmark.

**Bridge**

- `npm run bridge:install` and `npm run bridge:uninstall` on macOS and
  Windows (Chrome; on Windows also Brave, Edge and Chromium).
- The popup and options page show each CLI's version, or "not found".

**For contributors**

- Lint, typecheck, unit tests, Prettier, build and Playwright end-to-end
  tests run on every push (GitHub Actions). Node 22 or newer.
- `npm run pack` writes the release zip; `npm run shots` renders the
  screenshots from the built popup.
- `PRIVACY.md`, `SECURITY.md` and `RELEASING.md`.
