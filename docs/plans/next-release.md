# LocalPolish next-release plan

Status: draft. No implementation started.
Based on: [the 1.0.0 audit](../audits/1.0.0.md), 18 October 2026, Africa/Cairo.
Baseline: `v1.0.0`, commit `71d5cbf4fca3ff05dfc81c36b2f831b5a51ddef4`.

Fix privacy boundaries and draft safety first. Then fix settings and provider handling. Finish platform checks and release controls before adding the selected small features.

The original [T0-T14 plan](../plan.md) stays as the completed first-release record. This plan continues with T15. A task is done only after implementation, review, verification, and its own commit. All boxes below are unchecked deliberately.

## Release scope

The planned fixes cover A01-A22. P1 findings are required before a public release. Keep P2 findings in scope unless the owner explicitly defers one. P3 tasks are small follow-ups in the same plan.

Recommended additions after the fixes are F01, first-run setup, and F02, a plain final-text view. F03, secret isolation, is also worth doing if it fits. The other feature ideas remain a backlog. Optimization work starts with measurements and can be dropped if it has little effect.

Do not change `package.json` while implementing this plan. Follow [RELEASING.md](../../RELEASING.md) on release day. Its current policy requires a major release when users need a new bridge installation. T15h changes the installed wrapper, so including it implies that setup change under the current policy. Do not assume that this release will be 1.1.0. Explain the required bridge update in its release notes.

## Working rules

1. Use the `implement-plan` skill when execution starts. This document is a plan, not authorization to begin implementation during the audit.
2. Keep one commit per task. Update that task's status in its commit. Continue to the next ready task automatically.
3. Use small, exact briefs. A delegated implementer follows `implement-plan` in its light form: build, test, keep this file current, and report. It skips guard skills and the final review pass because the owner reviews each diff.
4. Small tasks stay inline. Use the configured feature lane for normal delegated work, the complex lane for settings concurrency or race-sensitive replacement, and the art lane for UI changes. Follow the current fleet configuration when execution starts.
5. Each delegated report ends with: "Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none."
6. Run the affected test file while working. Run the full project gates once at the end. Repeat checks only when later changes or failures justify them.
7. Never use real drafts for probes or press Send, Post, Reply, or Comment during manual tests. Use fixed sample text for paid-provider smoke checks.
8. Run `git pull --rebase` before every push. Stop on conflicts. Delete a merged task branch locally and remotely only after Git confirms it is merged. Use `-d` and preserve the protected branch names in the project instructions.

## T15: fix privacy and draft safety

### T15a. Enforce site policy across editor frames

- [ ] Fix A01.
- Files: `src/entrypoints/content.ts`, `src/entrypoints/background.ts`, `src/core/messages.ts`, and extension browser tests.
- Derive the top-level site and frame identity from Chrome sender metadata. Check both when deciding whether automatic work is allowed.
- Add a request trigger if the background needs to distinguish automatic fixes from selection-button and shortcut requests. Preserve the shortcut exception on hidden sites.
- Handle blank frames, `srcdoc`, inherited origins, and cross-origin frames. If automatic work has no trustworthy site identity, do not send it.
- Acceptance: blocking the parent tab or editor host stops automatic requests in all those frames. The shortcut still works. A normal unblocked editor still sends one request.
- Verification: load the built extension in Chromium with a local mock provider and count outgoing requests. Do not rely only on mocked `location` objects.
- Depends on: nothing.

### T15b. Apply settings changes to existing idle work and UI

- [ ] Fix A02.
- Files: `src/content/idle.ts`, `src/content/button.ts`, `src/entrypoints/content.ts`, and browser tests.
- Give the content UI an explicit refresh or cancellation path when `idleFix` or the blocklist changes.
- Cancel disabled timers and in-flight idle requests. Remove existing idle marks and floating buttons when they no longer qualify.
- Recheck eligibility before marker activation. Keep manual shortcut requests separate.
- Acceptance: turn idle Fix off or block the site while a request, marker, or button exists. The relevant UI disappears and cannot start another automatic or stale-marker request. Turning it back on works.
- Depends on: T15a's policy contract.

### T15c. Respect inherited spellcheck settings

- [ ] Fix A03.
- Files: `src/content/editable.ts` and browser editor tests.
- Use the effective spellcheck setting instead of only the own attribute.
- Acceptance: inherited false and explicit false send no idle request. A child with explicit true can still qualify. Existing search, code-editor, disabled, and read-only exclusions keep working.
- Depends on: nothing.

### T15d. Check the target again immediately before a delayed paste

- [ ] Fix A04.
- Files: `src/content/editable.ts` and editor browser tests.
- Capture enough target state to detect a changed draft or selection after a render wait.
- Immediately before each paste, check that both endpoints belong to the original editor and that the captured content is still valid.
- Return `changed` before writing if the target moved. Do not paste first and try to repair another editor afterward.
- Acceptance: move focus to another editor during the 50-millisecond wait. Both drafts stay unchanged. Repeat with an asynchronous update to the original editor. Normal Draft.js and Lexical Accept and Undo still work.
- Verification: real browser selection and paste handling. Keep a test that proves the second editor retains its literal original draft.
- Depends on: nothing. Coordinate its comparison helper with T15e without combining the tasks into one commit.

### T15e. Preserve line breaks in stale-text checks

- [ ] Fix A05.
- Files: `src/content/editable.ts` and editor browser tests.
- Use the same line-preserving representation for captured and current rich text. Limit normalization to intentional browser equivalences.
- Review success checks as well as pre-write checks. A newline-only rewrite must not report success if the editor ignored it.
- Acceptance: changes to paragraph splits, blank lines, and meaningful spaces are detected. Existing paragraph-editor, Draft.js, Lexical, and Undo cases pass.
- Depends on: nothing. Integrate with T15d's checks.

### T15f. Validate loopback endpoints exactly

- [ ] Fix A06.
- Files: `src/background/providers/openai.ts` and provider tests.
- Parse and validate the URL for every request. Distinguish actual loopback IPs from names that begin with `127.`.
- Keep the intended localhost names and IPv6 loopback support. Reject unsupported schemes.
- Acceptance: no fetch occurs for an HTTP endpoint such as `127.audit.invalid` when a key is set. Actual loopback endpoints work. HTTPS remote keys and keyless LAN endpoints retain their documented behavior.
- Verification: assert both the rejection and the absence of the fake key at the network boundary.
- Depends on: nothing.

### T15g. Complete process-group cleanup before exiting the bridge

- [ ] Fix A07.
- Files: `bridge/host.mjs`, `bridge/host.test.mjs`.
- Do not cancel escalation merely because the direct child exited. Finish or verify cleanup of the process group before the host exits.
- Keep final native frames flushed and remove the temporary directory after cleanup. Do not delay successful answers unnecessarily.
- Acceptance: a descendant with independent standard streams that ignores SIGTERM is gone after cancellation. Ordinary success, timeout, spawn failure, and disconnect leave no processes or temporary directories.
- Verification: harmless real processes with explicit cleanup in the test. Add Windows tree-cleanup coverage in T17d.
- Depends on: nothing.

### T15h. Quote the installed macOS wrapper safely

- [ ] Fix A08.
- Files: `bridge/install.mjs`, `bridge/install.test.mjs`.
- Generate literal shell arguments for Node, the host path, and PATH. Do not introduce a shell around rewrite text.
- Acceptance: a repo path containing `$(touch expanded)` starts the intended host without creating a marker. Cover spaces, single and double quotes, backticks, dollar signs, and non-ASCII characters.
- Keep Windows quoting and npm-shim handling working.
- Release note: users must rerun bridge installation to replace the wrapper. Apply the existing version policy.
- Depends on: nothing.

## T16: make settings and provider results reliable

### T16a. Serialize settings changes across extension pages

- [ ] Fix A09.
- Files: `src/core/settings.ts`, `src/core/messages.ts`, `src/entrypoints/background.ts`, `src/options/useSettings.ts`, provider form callers, and settings tests.
- Use one writer in the background. Send small update intents rather than whole stale records.
- Make model and effort changes specific to a provider. Apply endpoint changes and key clearing atomically.
- Acceptance: concurrent popup and options changes to different fields both survive. Two provider-model edits both survive. Changing an endpoint cannot attach its old key to the new origin.
- Verification: include the real built popup and options page in one Chromium extension profile. A queue within one hook is not enough.
- Depends on: nothing. Treat this as race-sensitive work.

### T16b. Preserve failed saves and block tests on save failure

- [ ] Fix A10.
- Files: `src/options/useSettings.ts`, `src/popup/useTest.ts`, `src/options/sections.tsx`, and settings UI tests.
- Return a success or failure result from `flush()`. Keep unsaved changes available for retry.
- Do not show Saved until storage confirms the update. Do not run Test connection after a failed flush.
- Check closing the toolbar popup during a debounced edit. If the last edit can be lost, use an acknowledged background save rather than an unload-only promise.
- Acceptance: a storage rejection leaves the new value visibly unsaved. Test connection sends no request. Retry saves the same patch, and the later test uses it.
- Depends on: T16a.

### T16c. Validate and normalize stored settings

- [ ] Fix A11.
- Files: `src/core/settings.ts`, `src/core/settings.test.ts`.
- Validate provider IDs, model and effort values, URLs, keys, temperature, booleans, modes, and blocklist entries at the storage boundary.
- Preserve valid fields when another field is damaged. Drop unknown properties and use safe defaults for invalid values.
- Keep existing migration behavior. Make future migrations explicit without adding a schema framework.
- Acceptance: null or mixed blocklist values, unknown providers, malformed maps, and out-of-range numbers do not crash the content script or settings UI. Valid custom model names survive.
- Depends on: T16a's write contract. Coordinate shared hostname rules with T16g.

### T16d. Reject explicit unsuccessful stream endings

- [ ] Fix A12.
- Files: `src/background/providers/openai.ts`, provider tests, and one built-extension browser test.
- Track an explicit terminal failure such as `content_filter`. Do not let `[DONE]` convert it into success.
- Preserve compatible DONE-only streams and successful stop-without-DONE streams. Keep existing length and transport truncation errors.
- Acceptance: filtered partial text never enables Accept. Successful compatible providers still produce a final answer.
- Depends on: nothing.

### T16e. Preserve wrappers already present in the original text

- [ ] Fix A13.
- Files: `src/core/cleanup.ts`, `src/core/cleanup.test.ts`.
- Strip only model-added wrappers. Preserve literal input markup, nested text tags, and existing code fences.
- Acceptance: unchanged `<text>hello</text>` remains unchanged. A wrapper added around an ordinary sentence is still removed. Outer whitespace keeps its existing behavior.
- Depends on: nothing.

### T16f. Detect missing complete emoji sequences

- [ ] Fix A14.
- Files: `src/core/tokens.ts`, `src/core/tokens.test.ts`.
- Compare complete emoji sequences rather than only their base pictographs.
- Acceptance: dropping `🇪🇬` or changing `👍🏽` to `👍` produces a warning. Joined families and keycaps are covered. Unchanged emoji produces no warning.
- Depends on: nothing.

### T16g. Use one site-entry parser everywhere

- [ ] Fix A15.
- Files: `src/core/settings.ts`, `src/popup/sites.ts`, `src/options/form.ts`, the two site editors, and their tests.
- Parse scheme, host, port, and path deliberately. Store a canonical hostname rule, not an unmatchable host-and-port string.
- Handle IPv6, IDNs, case, duplicates, subdomains, and supported wildcards. Reject malformed entries visibly.
- Acceptance: adding `example.com:8080/path` blocks `example.com` as the UI promises, or is visibly rejected. Both settings pages produce the same rule. Existing subdomain and shortcut behavior stays intact.
- Depends on: coordinate with T16c.

### T16h. Send the shortcut to one focused editor frame

- [ ] Fix A16.
- Files: `src/entrypoints/background.ts`, `src/entrypoints/content.ts`, and extension browser tests.
- Route or arbitrate shortcut handling so the top document does not show an error when a descendant has the editor focus.
- Acceptance: nested and cross-origin frame editors open one popup with no parent toast. No focused editor still produces one useful message.
- Depends on: T15a's frame identity work.

## T17: close documentation and release gaps

### T17a. Correct privacy and retention claims

- [ ] Fix A17.
- Files: `PRIVACY.md`, `README.md`, relevant popup help, and affected release notes.
- State what goes to disk, what stays temporarily in page memory, and what the CLI may retain.
- State where API keys go for authentication. Keep Grok's search and history exception next to any tools-off claim.
- Verify all automatic-send exclusions against the completed T15 behavior.
- Mark historical benchmark defaults and obsolete bridge behavior as superseded. Keep the current prompt and result set easy to find.
- Acceptance: every current privacy claim has a matching implementation or a stated limitation. Do not describe an unimplemented protection as shipped.
- Depends on: T15a-T15c and T16a-T16c.

### T17b. Add the idle switch to the full options page

- [ ] Fix A18.
- Files: `src/options/sections.tsx`, `src/options/App.tsx`, and options browser tests.
- Reuse the existing `idleFix` setting and save path. Keep the wording consistent with the toolbar popup.
- Acceptance: either page can change the setting and the other page reflects it. Disabling it affects an already-open tab through T15b.
- Depends on: T15b and T16a.

### T17c. Remove the vulnerable test dependency chain

- [ ] Fix A19.
- Files: `package.json`, `package-lock.json`, and the editor fixture only if necessary.
- Check current advisory ranges. Try a compatible patched Immutable 3.x override before changing Draft.js or removing its useful coverage.
- Keep development fixtures out of the production build.
- Acceptance: the full dependency scan has no unreviewed high-severity finding. Draft.js state, multiline Accept, Backspace, and Undo tests still pass. The production-only scan remains clean.
- Depends on: nothing. Do not run `npm audit fix --force` blindly.

### T17d. Test supported platforms and the minimum Node version

- [ ] Fix A20.
- Files: `.github/workflows/test.yml`, bridge tests, and manual release checklist.
- Keep the Linux browser gate. Add macOS and Windows jobs for bridge installation, framing, process behavior, and uninstall.
- Add a Node 22 compatibility check. Set explicit job timeouts.
- Add Windows process-tree coverage. Record fresh Windows setup and browser results with fixed sample text.
- Acceptance: platform-specific installer groups execute on their matching runners. A skipped POSIX test is not counted as Windows verification.
- Depends on: T15g, T15h, and T17c.

### T17e. Enforce checks before changes reach main

- [ ] Fix A21.
- Files: `.github/workflows/test.yml`; GitHub repository settings after a concrete ruleset is reviewed.
- Add `pull_request` checks and avoid redundant work where practical.
- Prepare a main ruleset requiring the test job. Confirm the intended direct-push and bypass policy before changing remote settings.
- Acceptance: a failing test prevents the proposed merge path. A passing change can merge. Keep private vulnerability reporting enabled.
- This task has a remote administrative step. The current audit does not apply it.
- Depends on: the final job names from T17d.

### T17f. Make the release guide match the actual workflow

- [ ] Fix A22.
- Files: `RELEASING.md`, relevant setup text, and `docs/manual-checklist.md`.
- Rebase before tagging and every push. Stop on conflicts. Recheck the commit and gates after a rebase that changes the release candidate.
- Explain which bridge code changes take effect after pulling and which installed files need reinstallation.
- Include safe merged-branch cleanup and the protected branch exclusions.
- State the bridge-update requirement and choose the release number only on release day.
- Acceptance: walk the guide on a temporary clone or review every command in sequence. The version, source commit, tag, zip, checksum, and required bridge setup agree.
- Depends on: T15h and the final release scope.

## T18: selected product additions

These tasks are proposed scope after the fixes. They are not required to mark A01-A22 fixed. Use the art lane for UI design and implementation if delegated.

### T18a. Add a first-run setup flow

- [ ] Proposed F01.
- Let a new user choose the provider, test it, and make an explicit choice about automatic text sending.
- Explain whether the selected endpoint is local or remote. Show the documented Grok history and search limitation when applicable.
- Preserve existing users' saved idle preference. Decide the new-install default before dispatching the UI brief.
- Acceptance: a fresh profile can reach a working fixed-sample test without reading the repo. No automatic draft request occurs before the new user's choice is saved.
- Depends on: T15, T16, and T17a.

### T18b. Add a plain final-answer view

- [ ] Proposed F02.
- Add Diff and Final views. Keep a read-only, selectable final answer available when clipboard access fails.
- Copy uses exactly the final answer in either view. Accept uses the same answer.
- Acceptance: when both clipboard paths fail, selecting Final yields only the proposed new text, without deleted words. Preserve selection, multiline text, keyboard use, and narrow-view layout.
- Keep editing before Accept and accepting individual changes out of this task.
- Depends on: T15d-T15e and T16e.

### T18c. Limit content scripts to non-secret preferences

- [ ] Proposed F03.
- Keep API keys available to the background and extension settings pages. Give content scripts only preferences they use.
- Restrict storage access appropriately and return a small preference message from the background. Validate sender contexts without breaking editor frames or fixed-sample tests.
- Acceptance: a content-script context cannot read key storage. It can still load and refresh site and idle preferences. API rewrites still authenticate from the background.
- This is hardening, not a fix for a demonstrated page-to-key exploit.
- Depends on: T16a-T16c and T15a.

## T19: measured optimizations

Record a baseline first. Keep an optimization only when its measurements justify the added code. Each retained task gets its own commit.

### T19a. Reduce bridge status overhead

- [ ] Proposed O01.
- Measure toolbar startup, version-probe duration, and process count for API and CLI configurations.
- Avoid bridge startup for API-only use until the user asks for bridge status. Run independent version probes in parallel under a deadline shorter than the caller's timeout.
- Acceptance: ordinary API popup opening starts no CLI version commands. A slow CLI probe cannot make a healthy host miss the overall status deadline. Check again bypasses any short cache.
- Depends on: T18a if it changes when bridge status appears, otherwise independent.

### T19b. Reduce idle work in long-lived tabs

- [ ] Proposed O02.
- Measure polling callbacks, text reads, layout work, memory retention, and overlapping provider requests for large editors and several tabs.
- Pause unnecessary work in disabled or hidden contexts. Use relevant browser events where they cover site movement reliably.
- Add a small concurrency limit only if measured overlap warrants it. Keep latest-draft behavior and manual requests responsive.
- Settle Close versus Stop behavior for an adopted idle request before changing cancellation. Closing the UI may intentionally retain a useful background answer.
- Acceptance: publish before and after measurements with the fixture and draft size. No missed marks, stale Accept, or extra requests in the existing behavior tests.
- Depends on: T15b. No broad scheduler or persistent bridge is planned.

### T19c. Avoid recalculating settled diffs and warnings

- [ ] Proposed O03.
- Measure large final answers during Copy, tab changes, and other UI updates.
- Cache by input and final answer only if repeated work is meaningful. Retain the diff timeout and full-replacement fallback.
- Acceptance: identical text and warnings, fewer repeated calculations, and a recorded before and after measurement.
- Depends on: T16f and T18b.

## Deferred feature backlog

| Audit ID            | Work                                                   | Prerequisite                                                                      |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| F04                 | Bridge protocol/version and redacted local diagnostics | Stable response contract and live CLI compatibility checks                        |
| F05                 | Key-free settings backup, validated import, and reset  | T16c                                                                              |
| F06                 | Named API profiles with credentials tied to an origin  | T16a and T15f                                                                     |
| F07                 | Temporary pause and later per-site defaults            | Correct live policy refresh from T15b                                             |
| F08                 | Stable bridge package and Linux installer              | Upgrade contract, platform tests, and an agreed setup migration                   |
| Existing limitation | LinkedIn partial multiline selection fallback          | Keep Copy working. Existing owner decision makes this lower priority.             |
| Quality follow-up   | Rephrase and Shorter benchmark corpus                  | Fixed sample inputs, preserved-token checks, and an explicitly scheduled paid run |

Do not add rewrite history or cloud sync by default. They add retention and account work without evidence of a current need.

## Release verification

- [ ] Run lint, typecheck, unit tests, Prettier, build, and the 91-test browser baseline plus the new regression cases.
- [ ] Run development and production dependency scans. Record any remaining advisory with its actual shipped scope.
- [ ] Confirm CI passes at the exact release commit on the supported platform jobs and the minimum Node check.
- [ ] Run the built extension against same-origin, cross-origin, blank, and `srcdoc` frame fixtures with an outgoing-request counter.
- [ ] Check changing the site and idle switches while a timer, request, marker, button, and popup already exist.
- [ ] Open the real popup and options page together. Verify concurrent edits, failed saves, and retry behavior.
- [ ] Run fixed-sample live smoke checks for each supported CLI and both HTTP adapter types. Record CLI versions, selected models, and results without secrets.
- [ ] Re-run the relevant manual checklist on Windows and macOS. Check plain text, Draft.js, and Lexical plus the real sites affected by replacement changes. Never submit drafts.
- [ ] Check keyboard use, screen-reader status and warnings, dark mode, browser zoom, narrow frames, and mixed-direction text. Record what was actually tested.
- [ ] Verify install, update, uninstall, resistant descendant cleanup, and paths with shell-special characters. Do not reuse the owner's live bridge registration for destructive tests.
- [ ] Review privacy and setup claims against the finished behavior. Add only shipped changes to the changelog.
- [ ] Follow the corrected release guide. Download the published zip, verify its checksum and manifest version, load it in a fresh profile, and test a fixed sample.
- [ ] Clean up merged task branches locally and remotely under the existing safe-deletion rules.

A release is ready when its selected tasks meet their acceptance checks and the remaining limitations are stated. Passing the old suite alone does not close the audit findings.
