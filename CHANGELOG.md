# Changelog

Each version here is one that has a tag and a GitHub release. What is
finished but not released yet waits under Unreleased. How a version ships:
[RELEASING.md](RELEASING.md).

## Unreleased

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
