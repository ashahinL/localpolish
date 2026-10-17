# LocalPolish

LocalPolish is a Manifest V3 Chrome extension that fixes or rewrites text in any web text field. It uses the AI subscriptions you already pay for, through their command-line tools, and it also supports providers that take an API key.

## Setup

You need macOS or Windows, Google Chrome, Node.js 20 or newer, and npm. You also need a logged-in `claude`, `codex`, or `grok` CLI, or an API key, or a local server.

1. Clone the repo and enter the folder.

```bash
git clone git@github.com:ashahinL/localpolish.git
```

```bash
cd localpolish
```

2. Install the dependencies.

```bash
npm install
```

3. Build the extension. The built files are in `dist/`.

```bash
npm run build
```

4. Open `chrome://extensions`. Turn on **Developer mode**. Click **Load unpacked**, then pick the `dist/` folder.

5. Install the bridge. The command prints which CLIs it found.

```bash
npm run bridge:install
```

6. Log in to each CLI you want to use. Do this once, in a terminal.

For Claude Code, run `claude` and log in.

```bash
claude
```

To log in without opening the Claude prompt, run this instead.

```bash
claude auth login
```

For Grok CLI, run this.

```bash
grok login
```

Codex needs its own login for LocalPolish. Your normal Codex home loads `~/.codex/AGENTS.md` into every rewrite. The command below uses a separate home, so your normal Codex login stays as it is. Add `--device-auth` at the end to log in with a code in the browser.

```bash
CODEX_HOME="$HOME/Library/Application Support/LocalPolish/codex-home" codex login
```

On Windows, run this in PowerShell instead.

```powershell
$env:CODEX_HOME="$env:LOCALAPPDATA\LocalPolish\codex-home"; codex login
```

7. Open the options page. Right-click the extension icon and choose **Options**. You can also open `chrome://extensions`, then open **LocalPolish**. Click **Details**, then **Extension options**. Pick a provider, then press **Test connection**.

## Using it

Select text in a text field. A small round button appears next to the selection. Click it.

Press `Cmd+Shift+K`. Chrome uses `Ctrl+Shift+K` when it is not running on macOS. With nothing selected, the shortcut uses the whole focused field.

The popup has four modes: **Fix**, **Rephrase**, **Shorter**, and **Tone**. Tone has **Polite**, **Formal**, **Casual**, and **Angry but civil**. The answer streams in. The popup then shows a word diff. Removed words are red. Added words are green.

**Accept** puts the new text in the field. The site's own Undo still works. Press `Cmd+Z` to bring the old text back. **Copy** copies the new text. **Retry** asks again. Esc closes the popup. `Cmd+Enter` accepts the text. `Ctrl+Enter` does the same.

**Shorter** shows a character count and warns when the result is over 280 characters.

A warning lists any link, @mention, #hashtag, code, or emoji that the rewrite dropped. Another warning shows if the rewrite changes Arabic script into another script.

If the site does not accept the change, the popup copies the new text and asks you to paste it with `Cmd+V`. Off macOS, that note says `Ctrl+V`.

To hide the button on a site, open the options page and go to **Sites**. Enter one hostname per line. Subdomains of that host are included. The shortcut still works on those sites.

## Providers

Choose a provider on the options page. Model and thinking effort are dropdowns. Each one has presets and **Custom**. You can change them at any time.

| Provider              | How it connects                                                                            | Default model and effort                                     |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Claude Code           | Bridge to the `claude` CLI, on your Claude subscription                                    | `haiku`, effort `low`                                        |
| Codex                 | Bridge to the `codex` CLI, on your ChatGPT subscription                                    | `gpt-6-luna`, effort `none`                                  |
| Grok CLI              | Bridge to the `grok` CLI, on your SuperGrok subscription                                   | CLI default, `grok-4.7`, effort `low`                        |
| OpenAI-compatible API | HTTP, with an optional API key. This covers OpenAI, xAI, OpenRouter, LM Studio, and Ollama | Base URL `http://localhost:11434/v1` for Ollama. Set a model |
| Anthropic API         | HTTP, with an API key                                                                      | `claude-haiku-5-5`                                           |

Those defaults are the cheapest setups that scored well on a Fix benchmark. The scores are in the [Fix mode benchmark, 2026-10-17](docs/benchmarks/2026-10-17-fix-mode.md).

The OpenAI-compatible provider can take an API key. Leave the key empty for a local server. The Anthropic provider needs a key. You enter keys on the options page.

Ollama blocks requests from extensions until you allow them. Start it like this.

```bash
OLLAMA_ORIGINS=chrome-extension://* ollama serve
```

You can set the same value for apps you launch from Finder. Restart the Ollama app after you run this.

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

## The bridge

The bridge is a small Node script. Chrome starts it through native messaging, under the name `com.localpolish.bridge`. It runs the CLI you chose, with your text on stdin, in an empty temp folder, and with tools off. It streams the answer back. The installer supports macOS and Windows. [ADR 0001, CLI bridge over native messaging](docs/adr/0001-cli-bridge-over-native-messaging.md) explains why.

On macOS, `npm run bridge:install` writes two files.

- The wrapper script is `~/Library/Application Support/LocalPolish/localpolish-bridge`. Chrome starts native hosts with a minimal PATH, so the wrapper sets a fixed PATH. The wrapper runs `bridge/host.mjs` from this repo. Keep this folder where it is.
- The host manifest is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.localpolish.bridge.json`. Chrome allows that host only for extension ID `ealpmjmaclnlpelpcacmbicmdipmbeei`.

On Windows, it writes two files in `%LOCALAPPDATA%\LocalPolish` and one registry key.

- The wrapper script is `localpolish-bridge.cmd`. It adds the Node and CLI folders to PATH and runs `bridge/host.mjs` from this repo.
- The host manifest is `com.localpolish.bridge.json`, next to the wrapper.
- Registry keys point Chrome, Brave, Edge and Chromium to the manifest, for example `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.localpolish.bridge`.

After the first install on Windows, quit the browser fully, then open it again. Closing the window is not enough if the browser keeps running in the background. Check Task Manager. Until then, the popup says the bridge is not installed.

npm installs a CLI on Windows as a `.cmd` file. A `.cmd` file needs a shell, and a shell can break the prompt text, so the bridge runs the script inside it with Node.

Run `npm run bridge:install` again after you install a new CLI, after you move this repo folder, or if Node moves.

Remove the bridge with this command.

```bash
npm run bridge:uninstall
```

The options page shows the bridge status. Each CLI shows its version, or the words "not found". **Test connection** checks the provider you picked.

## Sites that need Copy instead of Accept

Some sites ignore the text LocalPolish writes into the field. The popup then copies the new text and tells you to paste it with `Cmd+V`.

Results from the [manual checklist](docs/manual-checklist.md):

| Site           | Accept works | Notes                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail          | Yes          | Message body and subject. Undo, line breaks, Esc and the saved draft work.                                                                                                                                                                                                                                                               |
| X              | Yes          | Post composer and reply box. Undo, line breaks and Esc work, and Post and Reply stay ready.                                                                                                                                                                                                                                              |
| LinkedIn       | Yes          | Post composer and message box. Needed two fixes: the popup now mounts inside the modal dialog, and paragraph breaks no longer double. Two more for the message box: the shortcut now works with several lines, and a blank line no longer shows as three. Selecting only part of a multi-line message there can still fall back to Copy. |
| GitHub         | Yes          | Issue description. Undo, line breaks and Esc work, and the submit button stays enabled.                                                                                                                                                                                                                                                  |
| Plain textarea | Yes          | Test page. Undo, line breaks, Esc, and the text stays after a click outside.                                                                                                                                                                                                                                                             |

Tested on 2026-10-17 in Brave 1.97 on Windows 11 with the Claude CLI (haiku, low). The Copy fallback showed its note once in the LinkedIn message box, and `Ctrl+V` pasted the new text. The **Sites** list hides the button. `Ctrl+Shift+K` with nothing selected works in the LinkedIn message box, and says "Type some text first." when the box is empty.

## Troubleshooting

Match the message on screen, then do the fix that follows it.

- `The LocalPolish bridge is not installed. In the LocalPolish folder run: npm run bridge:install`. Run that command in this repo.
- `<cli> CLI not found. Install it, log in, then run "npm run bridge:install" again.` The message names the CLI, such as `codex`. Install it, log in, then run `npm run bridge:install` again.
- `Codex needs its own login for LocalPolish. In a terminal run: CODEX_HOME="..." codex login`. The message prints the real path in place of `...`. Run that command. The same command is in Setup.
- `Timed out after 60 seconds.` The bridge waited 60 seconds and did not get a finished answer. Try again, or pick a faster model.
- `Timed out after 45 seconds.` **Test connection** waited 45 seconds. Check that the CLI is logged in and that the model name is valid.
- `Cannot reach <url>. Is the server running?` Start the server at that URL, or correct the base URL on the options page.
- `HTTP 403: ...` When the base URL uses port 11434, the message adds `Ollama blocks unknown origins: set OLLAMA_ORIGINS=chrome-extension://* and restart Ollama.` Use the Ollama command in Providers, then restart Ollama.
- `Set a model name for the OpenAI-compatible provider in LocalPolish settings.` Open the options page and set a model for that provider.
- `Add your Anthropic API key in LocalPolish settings.` Open the options page and add the Anthropic API key.
- `LocalPolish was updated. Reload this page to use it.` You reloaded the extension. Reload each open tab before you use LocalPolish there.

## Privacy

Your text goes only to the provider you chose. A CLI provider sends it to that CLI on this computer. An API provider sends it to the URL you set. Settings and API keys stay in `chrome.storage.local` on this browser. Chrome does not sync them. LocalPolish does not log them.

## Development

Start WXT in dev mode. It hot-reloads the extension.

```bash
npm run dev
```

Other scripts:

- `npm run build` writes `dist/`.
- `npm run lint` runs ESLint.
- `npm run typecheck` runs the TypeScript check.
- `npm run test` runs the Vitest unit tests.
- `npm run test:e2e` builds, then runs Playwright. The suite has fixture-page tests. It also loads `dist/` into Chromium with a mock OpenAI server.
- `npm run format` runs Prettier.

Install the Playwright Chromium once.

```bash
npx playwright install chromium
```

Some sandboxed shells cannot start Chromium. The error mentions Mach ports. Run the end-to-end tests in a normal terminal.

```text
src/core            settings, prompts, cleanup, diff, tokens
src/background      providers, rewrite router
src/content         field capture and replace, popup, button
src/options
src/entrypoints
bridge/             native messaging host
tests/e2e           Playwright tests
docs/               plan, ADR, benchmark, briefs
```

The build plan is in [docs/plan.md](docs/plan.md).

## Not yet

- Passive underlines while you type.
- A tone setting per site.
- Rewrite history.
- A Linux bridge installer.
