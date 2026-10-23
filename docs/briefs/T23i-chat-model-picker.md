# T23i. Show every chat model choice

The owner found that Claude chat appeared to offer only Haiku. The model input uses a browser datalist, which filters suggestions against the already selected model name. During the hand check the owner clarified that thinking effort was missing too.

1. Replace datalist suggestions with a normal select for providers with presets. Show every existing preset plus Custom. Keep Grok's CLI default option. Reuse the preset data already used in options.
2. Keep arbitrary model names editable for OpenAI-compatible endpoints and for Custom. Preserve custom values across reloads and provider switches. Keep chat choices separate from Fix.
3. Add independent chat CLI effort settings beside the model choices, using the same model-dependent presets as Fix. The owner rejected shared effort during the hand check. Migrate once from normalized Fix efforts when a stored chat has no effort settings. Later chat effort changes must leave Fix unchanged, and the chat runtime must use chat efforts. Support custom effort and hide the row for models without choices. Preserve failed edits for retry and edits made during a save.
4. Keep the existing side-panel layout and tokens. Put custom inputs on their own rows when needed. Disable controls while a turn runs.
5. Update the existing settings-save browser tests and add coverage that selects non-default models for each preset provider, plus a custom-model round trip, effort visibility, failed effort saves, and in-flight effort changes. Use no real providers.
6. Review code, tests, and docs; run full gates and inspect the picker at narrow and wide widths. Keep this task in its own commit. The owner has reported the earlier native entry and insertion release checks as good. Recheck the changed picker before release.

## Checkpoint requests, resumed 23 October 2026

The owner resumed this checkpoint on 23 October 2026. Finish T23i before starting the T25 release checks. The complete state and failing checks are in [the handoff](../handoff-1.4.md).

- Show explicit Claude versions rather than only family aliases. Implemented with verified model IDs, including Opus 4.8, 5, and 5.5 and supported Haiku variants.
- Put provider, model, and effort dropdowns on one line. Implemented, with custom inputs below.
- Finish and verify independent `chat.efforts`. The missing entrypoint fixture fields are fixed. The handoff records final gate results. Earlier shared-effort results are historical.

## Model ID source

The explicit Haiku, Sonnet, and Opus CLI presets were checked against [Anthropic’s supported Claude Code models](https://support.claude.com/en/articles/11940350-claude-code-model-configuration) on 23 October 2026. Existing family aliases stay available. Custom remains available for other supported models. No live provider request is needed to populate these choices.
