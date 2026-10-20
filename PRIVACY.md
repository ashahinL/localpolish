# Privacy policy — LocalPolish

_Effective 19 October 2026._

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
- the list of sites where LocalPolish stays hidden;
- all-time request attempt counts for each provider and model. These
  include failed requests, retries, and Test connection. Cached answers do not count.
  An attempt starts before saving its count, so cancellation during that save
  still counts even if the provider has not been called.

Chrome does not sync this storage to your other devices, and LocalPolish
does not log it. Removing the extension deletes all of it.

Only trusted extension contexts, including the background, toolbar popup,
and options page, can read this storage. Content scripts receive only the
site list, idle Fix switch, and default mode. They cannot read stored API keys.

Usage stores only provider names, model names, and request counts. For Grok's CLI
default, new attempts use the model name reported at startup when available. It
stores no prompts, answers, keys, sites, URLs, dates, or per-request logs.
LocalPolish keeps no draft history and writes no text or answer to disk. While a tab is open, Fix while
I type keeps the last text it sent from each field and the answer in that
tab's memory, so the marker and the popup can reuse them. Closing or reloading
the tab clears them. What each CLI keeps is under "What it sends, and where"
below.

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
  tools turned off. Grok CLI can still search X and keeps its own session
  history in `~/.grok`. Claude Code saves no session
  (`--no-session-persistence`). Codex runs with `--ephemeral`, in a separate
  Codex home.
- **OpenAI-compatible API.** The text goes to the base URL you set, with
  your API key if you entered one. That can be a server on this computer,
  such as Ollama or LM Studio.
- **Anthropic API.** The text goes to Anthropic's API with your key.

**Test connection** sends a short fixed sample, not your text.

Fix while I type reads textareas and rich editors. It skips
single-line inputs, search boxes, CodeMirror and Monaco code editors, fields
with spellcheck off, and text under four words. This includes fields inside
an area that turns spellcheck off, unless the field turns it back on.
It skips every site on the **Sites** list, including editors inside frames
on those sites. Turn it off with its switch in the toolbar popup or the
options page.

## On web pages

A content script runs on every page so the button, the shortcut and Fix
while I type work in any text field. It reads a field when you select
text in it, press the shortcut, or use Fix while I type. While an idle marker
is shown, it also checks the field to keep the marker current. It changes a
field only when you press **Accept**, or accept a fix.

## What it does not do

- No account, no sign-in of its own, no server of ours.
- No analytics, no crash reporting, no ads, no tracking.
- No selling of data. It never sends text to a provider you did not pick.
- It sends each API key only to the provider it belongs to: the
  OpenAI-compatible key to the base URL you set, the Anthropic key to
  Anthropic's API. It never sends your settings or site list anywhere.

## Permissions

| Permission        | Used for                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `storage`         | Keeping settings, keys, site lists, and request counts on your device.                                                            |
| `nativeMessaging` | Talking to the bridge, `com.localpolish.bridge`, which runs the CLI you picked. Chrome lets only this extension's ID use it.      |
| `<all_urls>`      | Showing the button and Fix while I type in text fields on any site, and reaching the API base URL you set, which can be any host. |

## Changes and contact

Changes to this policy are published in this file, with its history, at
<https://github.com/ashahinL/localpolish/blob/main/PRIVACY.md>.
Questions: open an issue at <https://github.com/ashahinL/localpolish/issues>.

LocalPolish is not affiliated with, endorsed by or sponsored by Anthropic,
OpenAI or xAI.
