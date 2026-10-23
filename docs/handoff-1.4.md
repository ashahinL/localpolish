# LocalPolish 1.4.0 release record

Release date: 23 October 2026, Cairo. [v1.4.0](https://github.com/ashahinL/localpolish/releases/tag/v1.4.0) identifies the release commit and contains the downloadable extension zip, SHA-256, and package-verification result. Feature code is `8af0ea9`; the release commit changes the version and documentation only.

## Finished

T23a–j implement multi-turn chat, all four native entry points, selected-text attachments, local history, Copy, checked whole-field insertion, independent chat provider/model/effort settings, and the compact UI. T25 packages these as 1.4.0. Details are in [the feature plan](plans/features-1.3-1.4.md).

The owner approved native entry points and insertion, long-article chat with a CLI and an API provider, separate chat/Fix effort, and the final Impeccable polish. No further manual approval is pending for this release.

## Verification

Local gates passed on the final feature code: lint, typecheck, formatting, build, 822 unit tests with 2 platform skips, and 254 Chromium browser tests. Visual checks covered 320 px, 400 px, and 640 px, both themes, custom inputs, attachments, history, Markdown, Arabic text, keyboard use, and actual 200% browser zoom. Source metadata tests use mock providers only.

Pre-release GitHub [test](https://github.com/ashahinL/localpolish/actions/runs/40001655041) and [platforms](https://github.com/ashahinL/localpolish/actions/runs/40001912153) passed on `8af0ea9`, including runtime smoke checks, Windows/macOS bridge tests, and Node 22 checks. The final package is built from the release tag. Download verification and the isolated Test connection result are recorded on the release page and in the release chat.

Code, test, and docs guard reviews passed. Impeccable's scan found an old thick Markdown quote border, reduced to 1 px. The named Comment Sicko reviewer was unavailable and was skipped. No delegate ran and no reusable skill was proposed.

## Update an existing install

Run `git pull --rebase` in the bridge repo, stop on conflicts, and reload the extension and test tabs. No bridge reinstall or new login is needed for this update. Download `localpolish-1.4.0.zip` from the release, extract it, and load that folder unpacked.

On another machine, install Node, clone the repo, run `npm run bridge:install`, and complete local CLI logins if using CLI providers. Settings, keys, history, bridge registration, and CLI authentication stay local to each browser or machine.

## Next work and processes

No implementation task is queued. OpenCode remains in the backlog. The owner still schedules the optional paid language-preservation benchmark and Windows Antigravity login check. These were not run as part of release verification.

No delegate, development server, or test browser remains running after verification. GitHub jobs triggered by the release can be checked in Actions. The old `wip/chat-model-effort-handoff` branch was deleted locally and remotely after Git confirmed it was merged.

For future code changes, run lint, typecheck, unit tests, formatting, build, and the full browser suite. Keep one task per commit and pull with rebase before every push.
