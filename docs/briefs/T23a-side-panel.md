# T23a: prove the side panel entry points

## Task

Work only on T23a in `docs/plans/features-1.3-1.4.md:120`. The owner approved starting 1.4.0 and asked us to use the fleet. This spike is assigned to Claude. The current branch is `spike/t23a-side-panel`, based on `7a5ee13`.

1. Read the chat decisions and risks at lines 91-120 of the plan. Follow `/Users/ashahin/.agents/skills/implement-plan/SKILL.md` in its light form: build, test, keep the plan current, report. Skip loading guard skills and the final review pass. Do not delegate further.
2. Build a disposable, minimal Manifest V3 extension outside tracked production source. Use a dedicated temporary directory and report its absolute path. Include `sidePanel`, `contextMenus`, storage if needed, a popup, a content script on a synthetic local fixture, and a command with `Alt+Shift+L`. Never load this into the owner's existing Chrome profile. Use the installed Playwright Chromium with a temporary profile, following `tests/e2e/extension-runtime.ts:33-64`. No real CLI or provider calls.
3. Prove four paths with real trusted browser gestures: a content-script button click followed by a runtime message to the worker; a native context-menu item click; the real keyboard shortcut; and a toolbar popup button. Call `chrome.sidePanel.open` immediately in the handler, before any await that might lose the gesture. Read the selection separately and pass text, title, and URL to the panel using a ready handshake or storage so a cold panel receives it. Toolbar starts a plain chat with no selection. Check a second selection reaches an already open panel too.
4. Report which paths really opened a visible panel and delivered the expected payload. An API promise resolving, a fake event, a mocked API, `dispatchEvent`, `chrome.commands.onCommand` listener invocation, or navigating straight to the panel HTML does not prove that path. It is fine to use CDP browser input if it creates a genuine gesture. If native menu, shortcut, toolbar, or panel inspection needs headed Chrome or manual interaction, leave those checks explicitly unverified and preserve an exact runnable harness for the orchestrator. Do not spend a long time inventing automation workarounds. If browser launch is blocked by the child sandbox, report that promptly and leave the harness runnable outside it.
5. Add a short evidence note under T23a in the plan. Include the browser version, exact test command, per-path result, payload assertions, limitations, and recommendation for T23e. Tick T23a only if all required paths are proved. Set the plan status to 1.4.0 started. Keep the version at 1.3.0. Update the handoff with what is finished, the next task, required checks, and active processes. Do not implement T23b or any production chat UI.

## Constraints and checks

Use made-up text only. Never press Send, Post, Reply, or Comment. Do not read real drafts, change the installed extension, or use real providers. Stop temporary browsers and servers when finished unless the orchestrator needs the still-running browser for a missing UI check. Report any such process exactly.

Run the narrow spike check while working. The orchestrator runs the required full gates once before committing: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, and `npm run test:e2e`. Do not repeat these full gates yourself. Leave all changes uncommitted. Do not run git add, commit, push, merge, delete branches, or switch branches.

All user-facing times must use Cairo time, obtained with `TZ=Africa/Cairo date`. Keep the report short and factual. Do not claim a check passed unless you observed the result.

## Report

Report files changed, the disposable harness path and exact run command, each result with evidence, checks run, remaining blockers, and active processes. End the report with: Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
