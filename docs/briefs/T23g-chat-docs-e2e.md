# T23g. Chat documentation and combined browser check

Depends on T23e and T23f. Keep the package at 1.3.0 until the release checks pass.

1. Check the final Insert behavior against its content-script target tracking and worker validation.
2. Update README, privacy policy, changelog, manual checklist, release checklist, plan index, and machine handoff. Explain which field Insert replaces, when it refuses, and how to use Copy after a refusal. Keep native gesture and real-provider checks open until performed.
3. Add a browser test using fake article text and the local mock OpenAI provider. Focus a fixture field, select article text, open chat, ask a question, check the attachment and mock answer, then Copy and Insert. Assert the clipboard text and final field text.
4. Refresh the toolbar screenshots and check all five images. Give the screenshot fixture a tab and window id so Open chat renders enabled. Run lint, typecheck, unit tests, formatting, build, and the full browser suite. Inspect the changed UI in a browser. Record any machine limitation without marking unrun checks as passed.
5. Review documentation against the source and review the combined test. Update the plan and commit this task separately from T23f.

Do not call an installed CLI or a paid provider. Do not send or post a page draft. T25's release checks remain separate.
