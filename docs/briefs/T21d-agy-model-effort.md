# T21d. Antigravity model and effort

Lane: Sol medium (`second`). Follow the `implement-plan` skill in its light form: build, test, keep the plan current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. The owner reviews the diff.

Repo: LocalPolish, a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest, Playwright). T21c added the Antigravity CLI provider, `antigravity-cli`. The bridge runs `agy --model <model> [--effort <effort>]`.

## Problem

The owner's hand check found two problems. The model list repeats the effort ("Gemini 3.8 Flash, low") next to a separate "Thinking effort" box. Worse, some combinations break. Claude tested the real `agy` 1.4.4 through the bridge on 22 October 2026:

| `--model`               | `--effort` | Result                                                          |
| ----------------------- | ---------- | --------------------------------------------------------------- |
| `gemini-3.8-flash`      | none       | works                                                           |
| `gemini-3.8-flash`      | low / high | works                                                           |
| `gemini-3.8-flash`      | max        | error: no "max" effort                                          |
| `gemini-3.8-flash-low`  | high       | **error**: the model conflicts with `--effort`                  |
| `gemini-3.8-flash-high` | none       | works                                                           |
| `gpt-oss-120b`          | none       | works                                                           |
| `gpt-oss-120b`          | low        | error: only "medium" is available                               |
| `claude-sonnet-4-6`     | low        | error: `--effort` is not supported for this model               |
| `claude-opus-4-6`       | low        | error: `--effort` is not supported for this model               |

So today, "Gemini 3.8 Flash, low" with the effort "High" breaks every Fix.

## Goal

List Antigravity models by their plain names, and show an effort choice only when that model has one.

## Steps

1. **Presets** (`src/options/presets.ts`):
   - Change the `antigravity-cli` models to:
     - `gemini-3.8-flash`: Gemini 3.8 Flash
     - `gpt-oss-120b`: GPT-OSS 120B
     - `claude-sonnet-4-6`: Claude Sonnet 4.6
     - `claude-opus-4-6`: Claude Opus 4.6
   - Add `export function cliEfforts(provider: CliProviderId, model: string): Preset[]`.
     - Other providers: return `CLI_EFFORTS[provider]` unchanged.
     - `antigravity-cli`: `gemini-3.8-flash` gets Low, Medium and High. Every other listed model gets `[]`, meaning no effort choice. An unlisted (custom) model gets `[{ value: '', label: 'Model default' }]` plus Low, Medium and High, because LocalPolish can't know what it supports.
   - Replace every use of `CLI_EFFORTS[provider]` with `cliEfforts(provider, model)`: `ProviderSection.tsx` about line 112, and `src/popup/summary.ts` line 62.
2. **Settings** (`src/core/settings.ts`):
   - The default `antigravity-cli` model is `gemini-3.8-flash`, with effort `low`.
   - In `storedPatch`, migrate a stored Antigravity model `gemini-3.8-flash-low`, `-medium` or `-high` to `gemini-3.8-flash`, with that level as its effort. Migrate `gpt-oss-120b-medium` to `gpt-oss-120b` with effort `''`. Only the owner has these values from the unreleased build, but the migration is a few lines and keeps a reload from breaking the owner's Fix.
3. **Provider section** (`src/options/ProviderSection.tsx`, `CliSettings` about line 89; the popup's Provider tab reuses it):
   - Hide the effort picker and its help line when `cliEfforts(...)` is empty.
   - When the model changes, keep the current effort if the new model still offers it. Otherwise set it to the new model's first option, or to `''` when the list is empty. Do this inside the same `change((current) => …)` call as the model, so it is one save. Look at `useModelChange` and fit the change there.
   - Custom effort typing must still work for unlisted models, as it does today through `PresetPicker`.
4. **Summary** (`src/popup/summary.ts` `detail`): when the provider's current model has no effort choice, show only the model label, with no "· Effort: …".
5. **Bridge:** no change. An empty effort already skips `--effort`.

## Tests

- `src/options/presets.test.ts`: `cliEfforts` for each Antigravity model, a custom model, and one other provider (unchanged).
- `src/core/settings.test.ts`: the new defaults, and each migration.
- `src/popup/summary.test.ts`: Gemini with "Effort: Low", and Claude Sonnet 4.6 with no effort part.
- e2e (`tests/e2e/options.spec.ts`, or the spec that already covers the provider pickers):
  - With Antigravity and Gemini 3.8 Flash, the effort picker shows Low, Medium and High.
  - Switching to Claude Sonnet 4.6 hides it and saves effort `''`.
  - Switching back to Gemini saves effort `low`.

## Do not

- Do not restyle the popup or the provider chips. A separate art-lane task (T22d) polishes the layout after this one.
- Do not run a real CLI or a paid provider.
- Do not add dependencies or change the version. Do not commit. The orchestrator reviews and commits.

## Checks

npm needs `--cache /tmp/npm-cache-localpolish` if it uses a cache.

- Targeted: `npx vitest run src/options src/popup src/core`.
- Full gates once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, `npm run test:e2e`.
- If the sandbox blocks the browser tests, say so. The orchestrator runs them.

## When done

Add a ticked T21d entry under T21c in `docs/plans/features-1.3-1.4.md`: "- [x] **T21d. Antigravity model and effort.** Sol medium. Brief: [T21d-agy-model-effort.md](../briefs/T21d-agy-model-effort.md)."

## Report

List the changed files and the check results, say where the model-change effort reset lives, and anything in this brief you had to bend and why.

Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
