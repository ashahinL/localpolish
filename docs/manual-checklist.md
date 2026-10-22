# Manual checklist

Never submit a site's Send, Post, Reply or Comment action while testing. Use made-up text and close drafts without sending. Chat fixture tests may submit LocalPolish questions only to a local mock provider. The owner performs the real-provider release checks separately.

Work through one site at a time. Tick a box only after you see that result. Gmail, X, and LinkedIn each name two fields. Do every check in both fields before you tick the box. Skip a field only when the box says to.

On the options page, **Sites** takes one hostname per line. A listed host includes its subdomains. Remove the host from **Sites** after the blocklist check, or the button stays hidden for the later checks.

The popup follows the browser color scheme. For the dark-mode check, set the browser to dark mode, and turn the site dark mode on as well.

## Gmail

Use a compose window. Check the message body and the subject field. A subject is one line, so skip the multi-line check there. For the draft check, confirm the draft still holds the new text.

- [ ] Select text. The round button appears next to the selection. Add the host under **Sites**, then select text again. The button stays hidden. `Cmd+Shift+K` still opens the popup.
- [ ] Select part of the field. Choose **Fix**, then **Accept**. Only the selection changes. Press `Cmd+Z`. The site's own Undo brings the old text back.
- [ ] Focus the field and select nothing. Press `Cmd+Shift+K`. The rewrite covers the whole field.
- [ ] After **Accept**, the draft still holds the new text.
- [ ] Rewrite text that spans more than one line. The line breaks stay. Skip this on the subject.
- [ ] Press Esc. The popup closes. The composer stays open.
- [ ] If **Accept** fails, the note says the new text is copied. Press `Cmd+V`. The new text pastes into the field.
- [ ] With the browser and the site in dark mode, you can read the popup text.

## X

Check the post composer and a reply composer. Do not post. Watch the character counter and the Post button.

- [ ] Select text. The round button appears next to the selection. Add the host under **Sites**, then select text again. The button stays hidden. `Cmd+Shift+K` still opens the popup.
- [ ] Select part of the field. Choose **Fix**, then **Accept**. Only the selection changes. Press `Cmd+Z`. The site's own Undo brings the old text back.
- [ ] Focus the field and select nothing. Press `Cmd+Shift+K`. The rewrite covers the whole field.
- [ ] After **Accept**, the character counter shows the new length, and Post is ready for that text.
- [ ] Rewrite text that spans more than one line. The line breaks stay.
- [ ] Press Esc. The popup closes. The composer stays open.
- [ ] If **Accept** fails, the note says the new text is copied. Press `Cmd+V`. The new text pastes into the field.
- [ ] With the browser and the site in dark mode, you can read the popup text.

## LinkedIn

Check the post composer and a message box. Do not post, and do not send. Close the draft.

- [ ] Select text. The round button appears next to the selection. Add the host under **Sites**, then select text again. The button stays hidden. `Cmd+Shift+K` still opens the popup.
- [ ] Select part of the field. Choose **Fix**, then **Accept**. Only the selection changes. Press `Cmd+Z`. The site's own Undo brings the old text back.
- [ ] Focus the field and select nothing. Press `Cmd+Shift+K`. The rewrite covers the whole field.
- [ ] After **Accept**, Post is ready for the new text in a post, and Send is ready for it in a message. If the box has a character counter, it shows the new length.
- [ ] Rewrite text that spans more than one line. The line breaks stay.
- [ ] Press Esc. The popup closes. The composer stays open.
- [ ] If **Accept** fails, the note says the new text is copied. Press `Cmd+V`. The new text pastes into the field.
- [ ] With the browser and the site in dark mode, you can read the popup text.

## GitHub

Use an issue comment or a pull request comment. Do not click Comment. Confirm the textarea still holds the new text, and that Comment stays enabled.

- [ ] Select text. The round button appears next to the selection. Add the host under **Sites**, then select text again. The button stays hidden. `Cmd+Shift+K` still opens the popup.
- [ ] Select part of the field. Choose **Fix**, then **Accept**. Only the selection changes. Press `Cmd+Z`. The site's own Undo brings the old text back.
- [ ] Focus the field and select nothing. Press `Cmd+Shift+K`. The rewrite covers the whole field.
- [ ] After **Accept**, the textarea still holds the new text, and Comment stays enabled.
- [ ] Rewrite text that spans more than one line. The line breaks stay.
- [ ] Press Esc. The popup closes. The comment box stays open.
- [ ] If **Accept** fails, the note says the new text is copied. Press `Cmd+V`. The new text pastes into the field.
- [ ] With the browser and the site in dark mode, you can read the popup text.

## Plain textarea

Use any page whose field is a plain `<textarea>`. One example is `tests/e2e/fixtures/index.html`. There is no Send button. Click outside the field and confirm the new text is still there.

- [ ] Select text. The round button appears next to the selection. Add the host under **Sites**, then select text again. The button stays hidden. `Cmd+Shift+K` still opens the popup.
- [ ] Select part of the field. Choose **Fix**, then **Accept**. Only the selection changes. Press `Cmd+Z`. The old text comes back.
- [ ] Focus the field and select nothing. Press `Cmd+Shift+K`. The rewrite covers the whole field.
- [ ] After **Accept**, the field still shows the new text after you click outside it.
- [ ] Rewrite text that spans more than one line. The line breaks stay.
- [ ] Press Esc. The popup closes. The page stays as it was.
- [ ] If **Accept** fails, the note says the new text is copied. Press `Cmd+V`. The new text pastes into the field.
- [ ] With the browser in dark mode, you can read the popup text.

## Assistant chat, unreleased source build

Use a made-up article and a local mock provider. These checks do not replace the owner's CLI and API hand checks before the 1.4.0 release.

- [ ] Select two or more words outside text fields. The chat sparkle appears. A short or collapsed selection, editable field, blocked page, or blocked ancestor frame has no chat sparkle. The existing Fix button still works inside fields.
- [ ] Click the chat sparkle. The actual side panel opens and shows the selection, title, and full URL. No AI request starts until a quick ask or question is submitted. A second selection replaces the attachment in a new chat.
- [ ] Select text and use **Ask LocalPolish about this** in the native context menu. Repeat with the real chat shortcut, including a selection in a frame. Check that each opens the panel with the right attachment.
- [ ] Open the real toolbar popup and click **Open chat**. A plain chat opens, even if text remains selected. Repeat on a blocked site with the selection setting off.
- [ ] Turn off **Show chat button on selected page text** in options. The selection sparkle disappears immediately. Explicit chat entry points and manual Fix still work.
- [ ] Select fake text in a password field after selecting normal text. The shortcut must attach neither the password nor the previous selection.
- [ ] Ask two questions using the mock provider. Markdown, Copy, Stop and Retry work. Enter sends and Shift+Enter adds a line. The chat provider/model stay independent of Fix. Failed settings saves block requests.
- [ ] Open saved history, reopen a chat, delete one, then delete all test chats. Local settings and Usage remain. An oversized save leaves its answer visible with an error. No raw HTML executes and no remote image loads automatically.
- [ ] Open a second browser window. Its chat selection does not reset the first window's conversation. A restricted page without a content script opens plain chat through an explicit entry point.
- [ ] Inspect the panel at narrow and wide widths in both color schemes. The attachment, error text and composer remain readable.

T23f insertion and the combined selection-to-answer-to-Copy-and-Insert test are pending. Do not mark those complete from the current source build. T23e's new automated browser cases cover the selection and password-cache behavior. The new production context-menu and keyboard paths still need a native manual pass; T23a proved the browser gesture routes in a disposable spike.

## Results

The README has the same table.

| Site           | Accept works | Notes |
| -------------- | ------------ | ----- |
| Gmail          | Yes          | Message body and subject. Undo, line breaks, Esc and the saved draft work. |
| X              | Yes          | Post composer and reply box. Undo, line breaks and Esc work, and Post and Reply stay ready. |
| LinkedIn       | Yes          | Post composer and message box. Needed two fixes: the popup now mounts inside the modal dialog, and paragraph breaks no longer double. Two more for the message box: the shortcut now works with several lines, and a blank line no longer shows as three. Selecting only part of a multi-line message there can still fall back to Copy. |
| GitHub         | Yes          | Issue description. Undo, line breaks and Esc work, and the submit button stays enabled. |
| Plain textarea | Yes          | Test page. Undo, line breaks, Esc, and the text stays after a click outside. |

Tested on 2026-10-17 in Brave 1.97 on Windows 11 with the Claude CLI (haiku, low). The Copy fallback showed its note once in the LinkedIn message box, and `Ctrl+V` pasted the new text. The **Sites** list hides the button. `Ctrl+Shift+K` with nothing selected works in the LinkedIn message box, and says "Type some text first." when the box is empty.
