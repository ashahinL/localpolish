# Manual checklist

Never press Send, Post, Reply or Comment while testing. Use drafts and close them without sending.

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

## Results

Copy these rows into the table in the README when a site is tested. Until then, leave **Not tested yet**.

| Site           | Accept works   | Notes |
| -------------- | -------------- | ----- |
| Gmail          | Not tested yet |       |
| X              | Not tested yet |       |
| LinkedIn       | Not tested yet |       |
| GitHub         | Not tested yet |       |
| Plain textarea | Not tested yet |       |
