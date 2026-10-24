# LocalPolish redesign: decisions

Mockup: [mockup.html](mockup.html). Open it in a browser. The button at the top switches light and dark.

## Look

- Deep navy ink (`#18213a`) for text and main buttons. A yellow highlighter (`#ffe45c`) marks the active tab. In dark mode the main buttons turn yellow.
- Sections are separated by thin lines, not stacks of cards.
- System fonts, so Arabic and English both render well.
- The options page gets the same tokens and look.

## Popup

- Top: two buttons, **New chat** (filled) and **New document** (light). Both open the side panel.
- Under them: one line with the provider, model and thinking level, plus **Change** and **Test**.
- Tabs: Home, Provider, Sites, More.
  - **Home**: recent documents (last 3, documents only), then the Fix / Rephrase / Shorter choice.
  - **Provider**: provider list with radio buttons, Fix model and thinking, bridge status, Test connection.
  - **Sites**: "On this site" switch, Fix while I type switch and languages, hidden-sites list.
  - **More**: shortcut, Change shortcut, All options, usage table, version.

## Chat side panel

- Header: title, History, **+ Chat**, **+ Doc**.
- Model picker moves into a small chip inside the message box.
- Copy, Insert into field and Retry are small icon buttons under each answer.
- History has two lists: Chats and Documents.

## Documents (new)

A drafting board in the side panel, in the same place as chat.

| Topic | Decision |
| --- | --- |
| Text | Markdown, kept as plain characters. An Edit / Preview switch shows it formatted (read-only), using the chat Markdown renderer. |
| Title | A separate title field above the text. Empty shows "Untitled". |
| Correcting | The same behavior as a web field: Fix while I type, the floating button, the shortcut and the default mode. The content-script code does not run in extension pages, so the side panel must reuse it directly. |
| Fix while I type scope | The whole document, the same as web fields. The user accepted that long documents are slower and use more quota. The usual 256 KB input limit applies. |
| Switches | Follows the Fix while I type switch and the language choices. Site hiding does not apply. |
| Undo | Accepted fixes go into the document's normal undo history, so Ctrl+Z / ⌘Z undoes them. No version history. |
| Saving | Saved automatically while typing. Kept until the user deletes it. No 30-day or 50-item limit. Up to the 128 KB record size (about 20,000 words). |
| History | Separate Documents list in the side panel history. The popup Home tab lists recent documents. |
| Text out | **Copy** (plain Markdown text) and **Insert** into the page field the panel was opened from, like chat's Insert into field. No formatted copy, no download. |
| To chat | **Ask in chat** opens a new chat with the document attached, like selected text today. The document does not change. |

## Open details (defaults unless the user says otherwise)

- Insert is shown only when the panel knows the page field, the same rule chat uses today.
- The chat answer button "Open as document" is not planned.
- Deleting a document asks for confirmation, because documents are kept forever.
