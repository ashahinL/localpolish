# Changelog

Each version here is one that has a tag and a GitHub release. What is
finished but not released yet waits under Unreleased. How a version ships:
[RELEASING.md](RELEASING.md).

## Unreleased

**New**

- Documents: a drafting board in the side panel, next to chat. Write in Markdown, switch between Edit and Preview, and Fix the text with Fix while I type, the button and the shortcut, the same as in a web field. Accepted fixes undo with `Cmd+Z` / `Ctrl+Z`. **Copy**, **Insert** into the page field the panel came from, and **Ask in chat** with the document attached.
- Documents save as you type and are kept in this browser until you delete them. Each can be up to 128 KiB. Deleting asks first. LocalPolish now asks for `unlimitedStorage` so kept documents can go past Chrome's 10 MB default; Chrome shows no install warning for it.
- The toolbar popup starts with **New chat** and **New document**, then a line with the provider, **Change** and **Test**. Home lists the three newest documents. The tabs are Home, Provider, Sites and More: the quick switches moved to Sites, and usage moved to More.
- The side panel header has History, **+ Chat** and **+ Doc**. History has two lists, Chats and Documents, with short times like `12:40` and `Yesterday`.

**Changed**

- A new look on the popup, side panel and options page: navy ink, a yellow highlighter for the active tab, and sections split by thin lines. The icon is yellow. The in-page Fix popup on web pages keeps its look.
- Chat's provider, model and thinking pickers moved into a chip in the message box. Copy and Insert into field are smaller buttons under each answer.
- The provider line in the popup leaves out the word "Effort" and shows the full line on hover. The provider list shows each CLI's version number.

**Fixes**

- Popup icons now draw at their intended line width.

## 1.4.0 — 2026-10-23

**Bridge users:** run `git pull --rebase` in your LocalPolish repo to update the chat bridge. No bridge reinstall or new login is needed on an existing setup.

**New**

- Assistant chat in Chrome's side panel, with streamed Markdown, quick asks, Copy, an independent provider and model, and local history. History keeps up to 50 chats for 30 days, with a 128 KiB save limit per chat.
- **Insert into field** replaces the field focused before chat opened, through the existing Accept path. Changed, removed, navigated, or inactive targets are refused; Copy remains available. Saved history has no live insertion target.
- Open chat from a page-text selection sparkle, the selection context menu, `Alt+Shift+L` or macOS `Option+Shift+L`, or **Open chat** in the toolbar. The panel shows its attachment before anything is sent to an AI.
- An option to turn off the selection sparkle. Explicit chat entry points work on blocked sites.
- Multi-turn messages through every provider. CLI chat turns can run for 180 seconds; Fix keeps its 60-second timeout. Bridge users need the current repo code through `git pull --rebase`.

**Safer**

- Selected page text is treated as untrusted data. Markdown uses a safe subset without raw HTML or automatic remote images, with bounded nesting and parsing of unmatched markers.
- Chat settings must save before sending. Attachments stay within their browser window, and password values are excluded from shortcut selection caches.

**Fixes**

- Compact chat typography and controls, a smaller attachment preview, quieter quick asks, and consistent Markdown spacing. Long source URLs stay on one line with the full address available on hover.
- Chat's model dropdown shows every preset, including explicit Claude versions and latest-family aliases, with Custom for other names. Provider, model, and effort dropdowns share one row, with custom inputs below. The old autocomplete filtered the list to the model already entered. Chat also has its own thinking-effort selector, separate from Fix, and failed setting edits remain available for retry.

**For contributors**

- T23a–j cover chat, entry points, insertion, independent model/effort settings, compact UI, and the combined browser flow. Local gates passed with 822 unit tests and 254 browser tests. The owner approved the manual checks. See [the release record](docs/handoff-1.4.md).
- Restore the runtime benchmark compiler's output-budget module so its core smoke probes can run in CI.

## 1.3.0 — 2026-10-22

**Bridge users:** run `git pull` in your LocalPolish folder to get the new bridge code. To use Antigravity, also run `npm run bridge:install` again and log in once with the command it prints. Nobody else needs a reinstall.

**New**

- **Antigravity CLI provider.** LocalPolish can use Google's `agy` CLI with your Google account, including its free Gemini 3.8 Flash. Models are Gemini 3.8 Flash (effort Low, Medium or High), GPT-OSS 120B, Claude Sonnet 4.6 and Claude Opus 4.6. The effort picker shows only for models that have one.
- **Languages for Fix while I type.** English, Arabic, Franco-Arabic and Other can each be turned off, in the toolbar popup and on the options page. A draft mostly in a language that is off is skipped. In a mixed draft, parts in a language that is off are left as they are. The button and the shortcut still fix every language.
- The toolbar popup is wider (400 px), and the provider choices sit in an even grid, so no name wraps.

**Safer**

- Antigravity runs locked down, like the other CLIs. It gets an agent with no tools, a private home folder with its own login (so your rules and plugins don't load), and the draft only on stdin. After each answer, the bridge deletes that run's saved conversation and its generated title, and keeps only the 5 newest logs.
- Antigravity keeps its LocalPolish login in a file in that private folder, so macOS shows no "Keychain Not Found" dialog. If you saw one during testing, click Cancel, never Reset To Defaults.

**For contributors**

- `docs/plans/cli-spike.md` records the lockdown spike. OpenCode is not included: its free tier refuses requests with the file tools turned off, and with them on, text on a page could make it read local files.
- The popup screenshots are 400 px wide.

## 1.2.0 — 2026-10-21

**Bridge users:** run `git pull` in your LocalPolish folder to get the new bridge code. No `npm run bridge:install` is needed.

**Faster and lighter**

- Codex requests send only the writing instruction and your text. A short Fix went from about 9,400 input tokens to about 800. Your Codex settings, skills and login are untouched.
- The bridge health check runs only for CLI providers, runs its version checks at the same time, and reuses a good result.
- Idle Fix does no work on blocked sites or when it is off, and waits while the tab is hidden.
- The popup reuses its diff and notes, markers redraw only when something changed, and the selection button measures the page after the pause instead of on every move.
- A closed toolbar popup or options page cancels its running Test connection.
- Changing a provider, model or key no longer messages every open tab. Site and idle changes reach tabs in order, so a quick block and unblock ends in the right state.

**Safer**

- Text over 256 KiB is refused before anything is sent, with a message saying so.
- Answers over 1 MiB are stopped and fail instead of filling the page.
- Bridge messages, CLI output lines, API stream events and API error bodies all have size limits.

**Fixes**

- Discord: when Slate ignores Accept's paste, the draft stays editable and Accept offers Copy instead of forcing the text in.
- Whole-field Fix reuses a running check or a saved answer after you add trailing spaces or one final period. Accept and Copy keep the added ending without doubling the period.
- Opening a whole-field Fix after other edits cancels the old check and sends the latest full text. Closing its popup keeps the check running for the badge.
- Clearing a draft cancels its running check and removes saved results and badges. Late replies stay ignored, and empty drafts send no automatic request.
- Usage counts Grok's default model under the model Grok reports.

**For contributors**

- A runtime benchmark (`bench/`) and a request lifecycle benchmark, with results for this release in `bench/results/`.
- CI builds the extension once and reuses it for the browser tests.
- The 1.1.0 performance review, its plan, and the release candidate check are in `docs/audits/` and `docs/plans/performance.md`.

## 1.1.0 — 2026-10-20

**New**

- Home and the options page show **Usage**: request counts for each provider and model, with a total. Counts start with this update.

- Request attempts are counted locally by provider and selected model, including failures and Test connection, without storing draft history (T19a).

- First-run setup opens on install with provider, connection test, and Fix while I type controls. Missing-bridge errors stay quiet for idle Fix (F01).

- The rewrite popup has a **Changes | Final** switch. Final shows only the new text, and the popup switches to it when Accept and Copy both fail (F02).

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

- Accept stops before native fallback if a page paste handler moves selection to another editor or changes the selected text (T20).

- Accept pastes into every rich text box first, so editors that keep their own copy of the text (Discord, X, Facebook, Slack, ChatGPT and others) stay in sync and Backspace keeps working. Plain boxes fall back to typing the text in. Tests cover plain, Lexical, Draft.js, Slate, ProseMirror and Quill boxes.

- The options idle checkbox sits beside its label and no longer stretches across its column (T19c).

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
