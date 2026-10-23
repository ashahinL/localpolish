# Resume the chat controls checkpoint

Status: unfinished work saved at the owner's request on 23 October 2026. Stop after documenting, committing, and pushing. Do not resume implementation or release until the owner asks. Package version remains 1.3.0. No 1.4.0 release or tag was created.

Checkpoint branch: `wip/chat-model-effort-handoff`. It starts at `9712d79`, the last verified main commit. Use `git log -1 --oneline` for the checkpoint commit itself.

## Continue on another machine

```bash
git fetch origin
git switch --track origin/wip/chat-model-effort-handoff
git pull --rebase
npm ci
```

If that branch already exists locally, use `git switch wip/chat-model-effort-handoff` instead of creating it again. Stop on rebase conflicts. Read this handoff and `docs/briefs/T23i-chat-model-picker.md` before editing.

Run `npx playwright install chromium` and rebuild with `npm run build`. Load this checkout's `dist/` unpacked in Chrome and reload the extension and test tabs after builds. On the new machine, run `npm run bridge:install` and complete local CLI logins only if CLI testing is needed. Browser settings, keys, history, bridge registration, and CLI logins do not sync between machines. Never call a real provider during automated tests.

## Finished and pushed on main

- `b58f7fe`: T23f, insert chat answers into the remembered whole text field through `applyReplacement`. Reject changed, removed, navigated, or inactive targets. Copy remains available. Selection and insertion frame ownership stay separate.
- `80b6930`: T23g, chat/Insert documentation, combined selection-to-mock-answer-to-Copy-and-Insert browser test, and five refreshed toolbar screenshots.
- `9712d79`: T23h, restore `src/background/outputBudget` to the runtime benchmark compiler. All 15 runtime smoke scenarios then passed twice locally.
- GitHub test and platforms workflows both passed on `9712d79`: [test run](https://github.com/ashahinL/localpolish/actions/runs/39757676770), [platforms run](https://github.com/ashahinL/localpolish/actions/runs/39757676985).
- The owner said the earlier manual chat checks looked good, then raised the model/effort issues below. Do not treat the new controls as approved or release-ready.

## Current unfinished work: T23i

The original model input used a datalist. With `haiku` entered, the browser filtered its suggestions to Haiku. It has been replaced with a preset select plus Custom input. Custom model names and existing per-provider choices persist. CLI default remains available for Grok.

An effort selector was added. The first implementation shared effort with Fix. The owner explicitly rejected that behavior. The current source changes effort to independent `settings.chat.efforts`; the picker reads it, `useChatSettings` saves it inside chat settings, and `chatSettings` maps it into provider requests. Fix retains top-level `settings.efforts`. The shared label has been removed. This final independent implementation is NOT fully verified.

Relevant files:

- `src/chat/ModelPicker.tsx`, `src/chat/chat.css`: model/effort controls and layout.
- `src/chat/useChatSettings.ts`: queued saves, retry, and new nested effort writes.
- `src/core/settings.ts`: chat effort defaults, checked reads, migration fallback, and partial merges.
- `src/background/chat.ts`: effective chat provider settings, including chat effort.
- `src/core/settings.test.ts`, `src/background/chat.test.ts`, `src/background/providers/cli.test.ts`: changed storage/runtime tests.
- `tests/e2e/chat.spec.ts`: model selection, custom round trips, effort separation, save failure, and in-flight save cases.

## Owner's latest requirements, still missing

1. Chat thinking effort must be independent of Fix in storage AND actual provider requests. Finish reviewing and verifying the current implementation. Check migration from stored chats without efforts: reads currently fall back to normalized Fix efforts, and persistence happens on a later save. Confirm the intended one-time-copy behavior and subsequent independence.
2. Show explicit Claude model versions, not only `Haiku`, `Sonnet`, and `Opus`. The owner mentioned Opus 4.8, 5, and 5.5 and corresponding Haiku variants. No versioned preset expansion has been implemented or researched. Verify exact supported CLI model IDs before adding presets; do not invent them. Keep Custom available. Current Claude CLI presets still use short aliases in `src/options/presets.ts`.
3. Put provider, model, and thinking-effort dropdowns on ONE line. This is not implemented. The current CSS still has two columns and puts effort on another row. Keep custom-value inputs readable and test narrow/wide panels and both themes.
4. Recheck current documentation. README/changelog/manual checklist partly describe independent effort, but `PRIVACY.md` and some plan/historical text still mention shared effort. Update current contracts, preserving historical task records with an explicit superseding note where needed.
5. Finish T23i review and full gates, then commit it as a completed task. Keep T23i and T25 unchecked until their requirements pass. Release remains separate under `RELEASING.md`.

## Exact verification state

- Before the independent-effort change, the shared-effort implementation passed lint, typecheck, formatting, build, 811 unit tests with 9 platform skips, and 253 browser tests through Brave. Those results DO NOT verify the current independent-effort source.
- Last checkpoint checks on the CURRENT independent source: `npx vitest run src/core/settings.test.ts src/background/chat.test.ts src/background/providers/cli.test.ts` passed, 95 tests across 3 files.
- CURRENT `npm run typecheck` FAILS. `src/background/entrypoint.test.ts` at lines 1053 and 1171 passes settings fixtures whose nested `chat` objects omit required `efforts`. Update the fixture builder and rerun. Do not weaken the type.
- No final full lint, formatting, build, unit, browser, or CI pass was completed after independent effort was introduced. Browser tests were edited to assert nested chat effort and unchanged Fix effort, but have not been rerun in this form.
- The effort subagent hit its usage limit before finishing its final test/review report. Inspect its actual diff; do not assume its work is complete. Earlier delegate reports proposed no reusable skill; none was created.
- Comment Sicko was unavailable. Earlier completed work received orchestrator code/test/docs guard reviews; current independent-effort changes still need their final review.

Required final gates:

```bash
npm run lint
npm run typecheck
npm test
npx prettier --check .
npm run build
npm run test:e2e
```

This Windows machine's bundled Playwright Chromium 156.0.8078.4 fails before launch with a side-by-side assembly error, even after reinstall. Earlier local browser checks used installed Brave 155.1.97.59 through a temporary hook at `%TEMP%/localpolish-brave.cjs`, overriding Chromium launch/executablePath and removing the Mac-only `--single-process` argument. The repository browser configuration is unchanged. Use normal Chromium on the next machine if available. Do not weaken assertions or use paid providers to bypass launch failures.

The Windows Brave unpacked extension was confirmed to load this checkout's `dist/`. Native panel inspection showed Opus and the effort control in the older shared build. That does not prove independent effort behavior. Temporary UI captures are supplementary, not committed evidence.

## Release and cleanup

T25 is unfinished. Recheck the corrected controls with the owner, rerun latest-main test/platform workflows, then follow `RELEASING.md`. The paid language-preservation benchmark and Windows Antigravity login check remain unverified from earlier work. Never submit a real page draft while testing.

No implementation should remain running at handoff. Stop task-owned test servers and browsers, without closing the owner's normal browser. Keep this checkpoint branch until it is merged; then delete it locally and remotely only if Git lists it as merged, following the owner's branch rules.
