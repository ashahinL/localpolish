# Privacy policy — LocalPolish

_Effective 18 October 2026._

LocalPolish is a browser extension for Chrome. It talks to no server of
ours, has no account and no analytics. Your text goes to the AI provider you
pick, and nowhere else. This page says exactly what it touches.

## What it stores

Everything stays in the extension's storage (`chrome.storage.local`) in this
browser, on your device:

- your settings: the provider, model, thinking effort, temperature, default
  mode, and whether Fix while I type is on;
- the API keys and base URL you enter for the OpenAI-compatible and Anthropic
  providers;
- the list of sites where LocalPolish stays hidden.

Chrome does not sync this storage to your other devices, and LocalPolish
does not log it. Removing the extension deletes all of it. Your text and the
rewrites are not stored: an answer is kept only while the popup next to the
field is open.

## What it sends, and where

LocalPolish sends text only when you ask for a rewrite (the button, the
shortcut, or a tab in the rewrite popup), or when Fix while I type runs after
you pause in a message field. It sends the text you selected, or the whole
field when nothing is selected, together with the instructions for the mode
and tone. Where it goes depends on the provider you chose:

- **Claude Code, Codex or Grok CLI.** The text goes through Chrome's native
  messaging to the LocalPolish bridge on this computer, which passes it to
  that CLI on stdin. The CLI sends it to its own service (Anthropic, OpenAI
  or xAI) under your subscription and their privacy policies. The bridge
  runs the CLI in an empty temp folder, deleted when the run ends, with its
  tools turned off. Claude Code runs with `--no-session-persistence` and
  Codex with `--ephemeral`, in a separate Codex home. Grok CLI keeps its
  own session history in `~/.grok`, and can still search X.
- **OpenAI-compatible API.** The text goes to the base URL you set, with
  your API key if you entered one. That can be a server on this computer,
  such as Ollama or LM Studio.
- **Anthropic API.** The text goes to Anthropic's API with your key.

**Test connection** sends a short fixed sample, not your text.

Fix while I type only reads message boxes and rich editors. It skips
single-line inputs, search boxes, code editors, fields with spellcheck off,
text under four words, and every site on the **Sites** list. Turn it off
with its switch in the toolbar popup.

## On web pages

A content script runs on every page so the button, the shortcut and Fix
while I type work in any text field. It reads a field only when you select
text in it, press the shortcut, or pause typing in it with Fix while I type
on. It changes a field only when you press **Accept**, or accept a fix.

## What it does not do

- No account, no sign-in of its own, no server of ours.
- No analytics, no crash reporting, no ads, no tracking.
- No selling or sharing of data. It never sends your settings, keys or site
  list anywhere, and it never sends text to a provider you did not pick.

## Permissions

| Permission        | Used for                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `storage`         | Keeping the settings, keys and site list above on your device.                                                                    |
| `nativeMessaging` | Talking to the bridge, `com.localpolish.bridge`, which runs the CLI you picked. Chrome lets only this extension's ID use it.      |
| `<all_urls>`      | Showing the button and Fix while I type in text fields on any site, and reaching the API base URL you set, which can be any host. |

## Changes and contact

Changes to this policy are published in this file, with its history, at
<https://github.com/ashahinL/localpolish/blob/main/PRIVACY.md>.
Questions: open an issue at <https://github.com/ashahinL/localpolish/issues>.

LocalPolish is not affiliated with, endorsed by or sponsored by Anthropic,
OpenAI or xAI.
