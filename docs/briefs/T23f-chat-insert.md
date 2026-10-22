# T23f: insert chat answers

Follow implement-plan in light form: build, test, keep the plan current, report. The parent reviews the final diff. Do not commit or push.

1. Track the last focused supported editable separately from page-selection frame hints. Keep its field identity and text snapshot in the content script. Send only an opaque field id and frame ownership to the worker.
2. Bind that exact field to the entry sequence when chat opens, including plain toolbar chats and selections in another frame. Preserve attachment frame metadata separately.
3. Accept Insert only from sidepanel.html. Resolve the live session target by sequence, require the original active tab and focused window, then route to its bound frame and field. Reject changed, removed, disabled, readonly, password, unsupported, navigated and stale targets.
4. Replace the whole field using applyReplacement, preserving its existing paste-first editor behavior. Label the button clearly and report success or a helpful error with Copy as fallback. History and fresh chats without a live entry cannot insert.
5. Add unit and fixture-browser tests using fake text and the mock OpenAI server only. Run targeted tests, typecheck and build. Update only T23f plan notes.

Report files, design, exact checks and open concerns. Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
