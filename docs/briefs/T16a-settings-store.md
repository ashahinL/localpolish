# T16a. Safe settings writes, checked settings reads, one site rule

Fixes audit A09, A11 and A15 ([audit](../audits/1.0.0.md)). Lane: Sol medium. All three live in `src/core/settings.ts`, so they share one commit. If T15a is still open, do T15a first: both touch callers of `isBlocked`.

## 1. A09: two pages saving at once

**Problem.** `saveSettings()` (`settings.ts:108-123`) reads the whole record, merges the patch and writes the whole record. The queue in `src/options/useSettings.ts:34` only orders saves inside one page. The toolbar popup and the options page are two pages, so two saves in the same few milliseconds can drop one change.

**Fix.** Wrap the read-merge-write in a lock:

```ts
function withSettingsLock<T>(work: () => Promise<T>): Promise<T>
```

- When `globalThis.navigator?.locks` exists, use `navigator.locks.request('localpolish-settings', work)`. Extension pages share an origin, so this lock covers the popup and the options page together.
- Otherwise, fall back to a module-level promise chain. Node 22 may not have Web Locks; Chrome always does.
- `saveSettings` runs its body inside the lock. Nothing else changes in its contract.
- Out of scope: per-provider model and effort merging. `pickSettings` sends the page's whole `models` record, so two windows editing models for two different providers in the same instant can still overwrite each other. That is very unlikely; leave it and say so in the report.
- `baseUrlPatch()` in `src/options/form.ts` already returns the new base URL and the cleared key in one patch, so a URL change and its key clear stay in one locked write.

**Tests** in `src/core/settings.test.ts` (it already fakes `chrome.storage.local` with a `memory` map):

- Make the fake `get` wait one macrotask, start `saveSettings({ idleFix: false })` and `saveSettings({ defaultMode: 'shorter' })` together, await both, and expect both values stored.
- Import `settings.ts` twice with `vi.resetModules()` so each copy has its own fallback chain, save from each copy at once, and expect both values. This proves the shared lock, not the per-module chain. Skip this one with `it.skipIf(!globalThis.navigator?.locks)`.

## 2. A11: damaged stored settings crash the extension

**Problem.** `storedPatch()` (`settings.ts:70-83`) spreads every stored field into the patch and only checks `defaultMode` and `idleFix`. A stored `blocklist: [null]` makes `isBlocked()` throw (`entry.trim`), and a `null` model survives loading.

**Fix.** Rebuild `storedPatch()` to copy only known fields, each checked:

| Field                                                 | Keep when                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `provider`                                            | one of the five `ProviderId` values                                        |
| `models`                                              | a record; keep only entries whose key is a `ProviderId` and value a string |
| `efforts`                                             | a record; keep only entries whose key is a `CliProviderId` and value a string |
| `openaiBaseUrl`, `openaiApiKey`, `anthropicApiKey`    | a string                                                                   |
| `temperature`                                         | a finite number from 0 to 1                                                |
| `defaultMode`                                         | as today (`'tone'` and other values become `'fix'`)                        |
| `idleFix`                                             | as today (a boolean)                                                       |
| `blocklist`                                           | an array; keep only its string entries                                     |

A field that fails falls back to its default from `DEFAULT_SETTINGS` through `mergeSettings()`. Unknown fields, including the old `defaultTone`, are dropped. Valid custom model names, such as `my-model:7b`, stay.

**Tests** in `settings.test.ts`, next to "loads an old tone default mode as Fix and drops the old default tone": `blocklist: [null, 'a.com', 5]` loads as `['a.com']`; `models: { 'codex-cli': null, 'claude-cli': 'opus', bogus: 'x' }` loads with the Codex default, `opus`, and no `bogus`; `provider: 'nope'` loads the default provider; `temperature: 7` loads `0.3`; an unknown field is dropped.

## 3. A15: some site entries never match

**Problem.** The toolbar popup's `addSite()` (`src/popup/sites.ts:40-60`) keeps whatever is before the first `/`, so `example.com:8080/path` is stored as `example.com:8080`. `isBlocked('example.com', …)` never matches it, but the popup shows it as blocked. The options page textarea (`parseBlocklist` in `src/options/form.ts:5`) accepts any line.

**Fix.** One normalizer, used by everything:

```ts
/** The hostname rule for a site entry, or null when it is not a site. */
export function normalizeSiteEntry(entry: string): string | null
```

In `settings.ts`, replacing `normalizeBlockEntry` (lines 135-142):

1. Trim. Parse with `new URL(entry)` when it contains `://`, else with `new URL('http://' + entry)`. Take `.hostname`. This lowercases, drops the port and path, keeps IPv6 brackets (`[::1]`, which is also what `location.hostname` gives), and turns an international name into its `xn--` form, which is also what `location.hostname` gives. `*` is allowed in a URL host, so `*.example.com` parses.
2. Then strip leading `*.` and `www.` from the hostname, as today. Parse first, so `https://www.example.com` also loses its `www.`.
3. Return `null` when parsing throws or the hostname is empty.

Then:

- `isBlocked()` uses it.
- `addSite()` stores the normalized host, and returns `HOST_ERROR` when it is `null`. `sameHost()` and `siteState()` compare normalized values.
- The options page keeps the textarea as typed, but `SitesSection` (`src/options/sections.tsx:134`) shows a short note under it listing lines that are not sites: `Not a site, ignored: <line>`. Use the existing `Note` control.

**Tests.**

- `settings.test.ts`: `isBlocked('example.com', ['example.com:8080/path'])` is true; `['https://Example.com/x']` is true; `['*.example.com']` blocks `sub.example.com`; `['[::1]:5179']` blocks `[::1]`; `['bücher.de']` blocks `xn--bcher-kva.de`; `['not a site']` blocks nothing.
- `src/popup/sites.test.ts`: `addSite('example.com:8080/path', [])` stores `example.com`; `addSite('https://', [])` is an error; a duplicate written differently (`https://Example.com`) is "Already in the list".
- `src/options/form.test.ts`: the helper that finds bad lines.

## Done when

- Two saves at once from two pages both survive.
- Damaged stored settings load with safe defaults and never throw.
- Every accepted site entry blocks the host it names, in the popup and the options page alike.
- All gates pass.

## Rules

- Follow the `implement-plan` skill in its light form: build, test, keep `docs/plans/next-release.md` current, report. Skip the guard skills and the final review pass.
- While working, run only the test files you touch. At the end, run all gates once: `npm run lint`, `npm run typecheck`, `npm test`, `npx prettier --check .`, `npm run build`, then `npm run test:e2e`.
- Do not change the version in `package.json`. Do not call real CLIs or paid providers. Never use real drafts.
- Add one line per finding under `## Unreleased` in `CHANGELOG.md`, in the Fixes group.
- One commit, message `T16a: <summary>`. Tick T16a in `docs/plans/next-release.md` in the same commit. Run `git pull --rebase` before you push. Stop if it conflicts.
- Match the code around you. Comments only where the reason is not obvious. No new dependencies.

## Report

- What changed for A09, A11 and A15. Files touched. Gate results. Anything you could not verify.
- Choices you made that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
