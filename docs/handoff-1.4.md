# Continue the 1.4 release checks

T23i completed at `407da01` on 23 October 2026. The owner approved its manual checks, then paused publication for T23j, a compact chat UI polish using Impeccable. T23j is complete, with all local gates passed. Its task commit is the latest commit touching this handoff; use `git log -1 --oneline`. The revised panel awaits the owner's visual approval. Package version remains 1.3.0. No 1.4.0 release or tag exists.

## Checkpoint

- Base main commit: `9712d79`, T23h's runtime smoke compiler fix.
- Work branch: `wip/chat-model-effort-handoff`, based on the unfinished `c89129e` checkpoint. After completion and merge, continue from main. Use `git log -1 --oneline` to identify the current commit.
- Completed earlier: T23a–h implement chat providers, history, panel, entry points, Copy, insertion, documentation, and the smoke fix. See [the feature plan](plans/features-1.3-1.4.md).
- T23i adds preset/Custom selectors, explicit Claude versions, and independent `chat.efforts`. Provider, model, and effort share one row. Custom model and effort inputs appear below it. Existing family aliases and Grok's CLI default remain available.
- Older stored chats without effort values read normalized Fix efforts. The next successful settings save stores that copy independently. Later Fix edits and chat edits do not change one another. Runtime tests check the separate efforts sent to the native bridge.
- Fixed both entrypoint test-fixture type errors. Custom reload checks wait for actual persisted settings. Failed-save tests wait for the chat request's failure before allowing saves again. Otherwise a pending retry could succeed and attempt a CLI request.

## Verification

Targeted checks passed: 198 unit tests across settings, chat runtime, native provider, background entrypoint, and presets; four browser regressions covering custom reloads, layout, failed saves, and edits during a save. Built-panel screenshots cover 320 px and 640 px in both themes, plus full-width custom inputs. No real provider was called.

Final local gates passed on macOS: lint, typecheck, formatting, build, 822 unit tests with 2 platform skips, and all 254 Chromium browser tests. The final suite used the independent-effort source and versioned presets. Commands:

```bash
npm run lint
npm run typecheck
npm test
npx prettier --check .
npm run build
npm run test:e2e
```

Review uses clean-code-guard, test-guard, and docs-guard. The no-comments skill's named Comment Sicko reviewer is unavailable in this session, so that named pass is skipped. No delegate ran and no reusable skill was proposed. The small picker layout and save-test timing fixes belong in the existing tests rather than a new skill.

## Completed task: T23j

Impeccable's scoped polish keeps the existing visual identity. Chat body text is 13 px, controls are 12 px, and the header and composer are smaller. The attachment has a three-line preview and quieter metadata. Long URLs truncate on one line but keep the full accessible text and a hover title. Answers have a 75-character reading measure and consistent Markdown block spacing. Quick asks use neutral borders and an accent on hover.

Built-panel checks cover 320 px, 400 px, and 640 px in both themes, long titles/URLs, keyboard attachment expansion, history, Markdown, Arabic text, and actual 200% browser zoom without horizontal overflow. All 41 targeted chat browser tests passed before the final visual refinements. Final full gates passed: lint, typecheck, formatting, build, 822 unit tests with 2 platform skips, and 254 Chromium browser tests. Code and docs reviews passed. No real provider was called. The Impeccable scan found one old thick Markdown quote border, now reduced to 1 px. No new skill is needed for this small style pass.

## Next task: T25

The owner approved native entry, insertion, T23i's picker and separate efforts, and long-article CLI/API chat. The revised T23j panel still needs the owner's visual check before release. Reload `dist/` in the browser and check the versioned model choices, one-row controls, and separate chat/Fix effort. Then confirm a long-article chat with one CLI and one API provider. Never submit a real page draft while testing.

Check the latest GitHub test and platforms workflows on main, then follow [RELEASING.md](../RELEASING.md). Both workflows passed on the base `9712d79`; that does not verify T23i. Run platforms again on the completed main commit before tagging. Keep the version unchanged until the release checks pass.

The paid language-preservation benchmark and Windows Antigravity login remain unverified from earlier work. Do not call paid providers to bypass a test failure.

## Other-machine setup

Run `git pull --rebase`, stop on conflicts, and confirm a clean checkout. Run `npm ci`, `npx playwright install chromium`, and `npm run build`. Load `dist/` unpacked and reload the extension and test tabs. Run `npm run bridge:install` and complete that machine's CLI logins if CLI testing is needed. Settings, keys, history, bridge registration, and CLI logins do not sync between machines.

The Windows machine's bundled Chromium previously failed with a side-by-side assembly error; its earlier tests used Brave through a temporary external hook. This Mac uses normal Playwright Chromium. Repository browser configuration is unchanged.

## Active processes

T23j local checks finished and task-owned browsers and test servers closed. GitHub checks continue separately and are reported in the current chat. Platforms passed on `407da01`. Keep the work branch until Git lists it as merged; then delete it locally and remotely under the owner's branch rules.
