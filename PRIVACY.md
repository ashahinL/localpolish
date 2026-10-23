# Privacy policy — LocalPolish

_Updated 23 October 2026 for LocalPolish 1.4.0, including assistant chat and local chat history._

LocalPolish is a browser extension for Chrome. It talks to no server of
ours, has no account and no analytics. Your text goes to the AI provider you
pick, and nowhere else. This page says exactly what it touches.

## What it stores

Persistent data stays in the extension's storage (`chrome.storage.local`) in this
browser, on your device:

- your settings: the provider, model, thinking effort, temperature, default
  mode, language switches, whether Fix while I type is on, whether the selection chat button is on, and the separate chat provider and model;
- the API keys and base URL you enter for the OpenAI-compatible and Anthropic
  providers;
- the list of sites where LocalPolish stays hidden;
- all-time request attempt counts for each provider and model. These
  include failed requests, retries, and Test connection. Cached answers do not count.
  An attempt starts before saving its count, so cancellation during that save
  still counts even if the provider has not been called;
- completed chats with their title, turns, attachment text, page title, URL, and creation and update times. Up to 50 chats are kept. They expire 30 days after their last update and are pruned on save and browser start. Each serialized chat is limited to 128 KiB. An oversized save fails without truncating or replacing the stored chat. The answer stays visible. Delete one or use **Delete all** in History.

Chrome does not sync this storage to your other devices, and LocalPolish
does not log it. Removing the extension deletes all of it.

Only trusted extension contexts, including the background, toolbar popup,
options page, and side panel, can read this storage. Content scripts receive only the
site list, idle Fix switch, language switches, selection chat switch, and default mode. They cannot read stored API keys.

Usage stores only provider names, model names, and request counts. For Grok's CLI
default, new attempts use the model name reported at startup when available. It
stores no prompts, answers, keys, sites, URLs, dates, or per-request logs.
Fix keeps no draft history. Chat history stores text and answers locally as described above. While a tab is open, Fix while
I type keeps the last text it sent from each field and the answer in that
tab's memory, so the marker and the popup can reuse them. Closing or reloading
the tab clears them. What each CLI keeps is under "What it sends, and where"
below.

Source builds also use `chrome.storage.session` for pending chat attachments scoped to each browser window, their tab and frame targets, and focused-frame hints. A hint contains a frame id and frame URL, never selected text. Pending entries may contain selected text after an explicit chat entry-point action. These values are kept in the current browser session, separately from saved history. The page keeps its selected-text cache in memory so a shortcut can read it after the panel takes focus. Password input values are excluded. Content scripts cannot read session storage directly.

For Insert, the content script remembers the last focused supported text field. When chat opens, it captures that field's text in content-script memory to detect later changes. Only its opaque field id and frame ownership go into session storage. This target snapshot is not added to the chat attachment or sent to a provider. New chats started in the panel and reopened history do not retain a live insertion target.

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
- **Antigravity CLI.** The text goes through the bridge to `agy`, which sends it to Google under your Google account and Google's privacy policies. The bridge sets `HOME` to `~/Library/Application Support/LocalPolish/agy-home` on macOS, or `~/AppData/Local/LocalPolish/agy-home` on Windows. It also sets `USERPROFILE` on Windows. This private home holds the separate login and avoids loading your normal rules and plugins. Each run uses an agent with no tools, in its own temp folder. After the CLI exits, the bridge deletes that run's `.gemini/antigravity-cli/conversations/<id>.db` and `.gemini/antigravity-cli/brain/<id>/` inside the private home, including on errors, timeouts, and disconnects. It also deletes that run's row in `.gemini/antigravity-cli/conversation_summaries.db`, which holds a title Antigravity writes for each run, and keeps only the 5 newest log files. The logs don't contain your text. Deleting the row needs Node 22.13 or later. On older Node, the titles stay in the private home.
- **OpenAI-compatible API.** The text goes to the base URL you set, with
  your API key if you entered one. That can be a server on this computer,
  such as Ollama or LM Studio.
- **Anthropic API.** The text goes to Anthropic's API with your key.

For chat, opening an entry point only attaches text to the panel. Nothing is sent to an AI until you submit a question or choose a quick ask. Each turn sends the conversation so far, the selected text, its page title and URL, and the chat system instruction to the selected chat provider. It does not send the whole page or your browsing history. The panel shows the attachment. Chat uses the same CLI lockdown and provider connection as Fix. Its provider, model, and CLI effort have separate settings; credentials remain shared. Older chat settings without effort values copy the normalized Fix efforts when read; the next successful settings save stores that copy independently. A failed chat-settings save blocks sending until the displayed choices can be stored.

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
field only when you press **Accept**, accept a fix, or choose **Insert into field** on a chat answer. It also reads selected page text for chat and caches frame selection locally. The automatic chat sparkle skips blocked sites and editable fields. The context menu, chat shortcut, and toolbar button remain available when requested directly, including on blocked sites. Insert replaces the whole field remembered when chat opened. It checks the original active tab, window, frame, and unchanged field before writing. If the target is unavailable or changed, use Copy to paste the answer yourself.

## What it does not do

- No account, no sign-in of its own, no server of ours.
- No analytics, no crash reporting, no ads, no tracking.
- No selling of data. It never sends text to a provider you did not pick.
- It sends each API key only to the provider it belongs to: the
  OpenAI-compatible key to the base URL you set, the Anthropic key to
  Anthropic's API. It never sends your settings or site list anywhere.

## Permissions

| Permission        | Used for                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`         | Keeping settings, keys, site lists, request counts, local chat history, and session-only chat attachments and frame hints on your device. |
| `sidePanel`       | Showing the assistant chat beside the page.                                                                                               |
| `contextMenus`    | Adding the selected-text chat action to the right-click menu.                                                                             |
| `nativeMessaging` | Talking to the bridge, `com.localpolish.bridge`, which runs the CLI you picked. Chrome lets only this extension's ID use it.              |
| `<all_urls>`      | Showing selection buttons and Fix while I type on web pages, reading selected text for chat, and reaching your configured API base URL.   |

## Changes and contact

Changes to this policy are published in this file, with its history, at
<https://github.com/ashahinL/localpolish/blob/main/PRIVACY.md>.
Questions: open an issue at <https://github.com/ashahinL/localpolish/issues>.

LocalPolish is not affiliated with, endorsed by or sponsored by Anthropic,
OpenAI or xAI.
