# Continue the 1.4 release checks

T23i resumed on 23 October 2026 at the owner's request. The chat model and independent effort controls are implemented. Code, test, and documentation reviews and all local gates passed. Package version remains 1.3.0. No 1.4.0 release or tag exists.

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

## Next task: T25

The owner previously said the native chat entry and insertion checks looked good. T23i changes still need the owner's picker check before release. Reload `dist/` in the browser and check the versioned model choices, one-row controls, and separate chat/Fix effort. Then confirm a long-article chat with one CLI and one API provider. Never submit a real page draft while testing.

Check the latest GitHub test and platforms workflows on main, then follow [RELEASING.md](../RELEASING.md). Both workflows passed on the base `9712d79`; that does not verify T23i. Run platforms again on the completed main commit before tagging. Keep the version unchanged until the release checks pass.

The paid language-preservation benchmark and Windows Antigravity login remain unverified from earlier work. Do not call paid providers to bypass a test failure.

## Other-machine setup

Run `git pull --rebase`, stop on conflicts, and confirm a clean checkout. Run `npm ci`, `npx playwright install chromium`, and `npm run build`. Load `dist/` unpacked and reload the extension and test tabs. Run `npm run bridge:install` and complete that machine's CLI logins if CLI testing is needed. Settings, keys, history, bridge registration, and CLI logins do not sync between machines.

The Windows machine's bundled Chromium previously failed with a side-by-side assembly error; its earlier tests used Brave through a temporary external hook. This Mac uses normal Playwright Chromium. Repository browser configuration is unchanged.

## Active processes

No local implementation, browser, test server, or delegate remains running. GitHub test and platforms workflows are the next automated checks; their result is reported in the current chat. Keep the work branch until Git lists it as merged; then delete it locally and remotely under the owner's branch rules.
