# Remove Codex context from rewrite requests

Status: implemented, verified and committed locally as task P11. Not released. The owner requested this work after a live Luna request used 9,362 input tokens for `i has an apple`.

## Decision

Keep the existing Codex subscription login and CLI. Confine all changes to LocalPolish's rewrite invocation. Do not change the user's global settings or installed skills.

Disable automatic skill, agent, environment, and permission descriptions. Keep the read-only sandbox and disabled shell tools. Use a temporary copy of the selected model's cached metadata to remove its tool mode, patch tool, and experimental tools. Preserve all other model metadata. Missing, malformed, unreadable, unmatched, or more than five-minute-old metadata falls back to normal Codex model discovery with the reduced instruction settings. This lets Codex refresh its cache instead of freezing metadata indefinitely. Those fallback requests can carry more tool context.

This implements P11 from the [performance review](../audits/performance-1.1.0.md) before P00 because the owner requested token removal directly. The other performance tasks remain proposals.

## Task P11

- [x] Capture current CLI requests against a local endpoint with no account credentials or model inference.
- [x] Prove a request can contain only the writing instruction and user text, with zero tools.
- [x] Measure fresh Luna and Sol input counts using the current login.
- [x] Apply the verified settings and temporary model catalog in the bridge.
- [x] Cover cache fallback, metadata preservation, request arguments, and temporary-file cleanup.
- [x] Check the final production command with local capture and a small English, mixed-language, protected-text, and fragment comparison.
- [x] Run a real request through `bridge/host.mjs` using native-message framing. `she dont like it.` returned `She doesn't like it.` and a successful done message.
- [x] Compare all seven existing Fix benchmark cases three times on Luna, with both configurations, after the smaller sample showed quality misses.
- [x] Run unit tests, lint, typecheck, and build. Review the diff and commit this task separately.

## Initial evidence

Codex CLI 0.162.1 accepts the reduced settings. Local captures went from approximately 43,000 characters to 2,200, with only the Fix instruction and synthetic user text remaining. Fresh Luna none and Sol medium requests both reported 781 input tokens. The fresh Sol control reported 9,360.

These are token-reduction results, not proof of a general latency improvement. The first reduced Luna response added an unwanted final period to the fragment. Sol preserved the fragment. Compare more inputs before assessing quality.

Local diagnostic scripts and raw results are in `/Users/ashahin/.codex/visualizations/2026/10/20/localpolish-context-removal/`. These captures contain only synthetic inputs and model metadata, with no login credentials.

## How the reduction works

`skills.include_instructions=false` omits the skills catalogue. `agents.enabled=false` omits the agent tools and instructions. The `include_*` settings omit generated permission, environment, app and collaboration descriptions. These settings control prompt text. The read-only sandbox and shell restrictions still apply.

The model metadata also selects tools independently of those settings. On the checked CLI, Luna and Sol use `tool_mode: "code_mode_only"` and advertise experimental clock and user-message tools. A temporary `model_catalog_json` keeps the chosen model's other metadata and replaces only `tool_mode`, `apply_patch_tool_type` and `experimental_supported_tools`. Goal, image, plan and question tools are disabled separately. The final local captures contain exactly two messages, the existing Fix instruction and the text to fix. They contain no tool definitions.

The original model cache, global skills and global Codex settings are untouched. The bridge removes its temporary instruction and model files when the request ends. A native-host regression test checks the selected model's other metadata, original cache contents and temporary-file cleanup.

The mechanism was checked with Codex CLI 0.162.1 on macOS. Older CLI versions and live Windows behavior have not been verified.

## Verification

The [saved results](../../bench/results/2026-10-20-codex-context.json) contain token counts, synthetic inputs and outputs, quality predicates, ready-result timings, request-capture summaries and the real native-host smoke result. The smoke request took 24.7 seconds. It succeeded, but token removal does not prove faster responses. Request timings vary, and the native-host smoke overlapped with one request in the extended Luna comparison.

All 310 unit tests pass, with two existing platform skips. Lint, typecheck and build pass. The final code and tests were reviewed with clean-code-guard and test-guard; no additional findings remain. The requested Comment Sicko agent type and its definition are unavailable in this session, so that specialized pass is skipped. Comments were reviewed manually. The docs-guard pass checks the documented settings and results against the code, local CLI captures and saved evidence.

## Comparison results

| Comparison | Original | Reduced |
| --- | --- | --- |
| Luna, all seven Fix cases repeated three times | 16/21 passed; 9,360–9,398 input tokens | 18/21 passed; 781–817 input tokens |
| Sol medium, four cases plus a repeated fragment | 5/5 passed; 9,360–9,398 input tokens | 5/5 passed; 781–817 input tokens |
| Luna median ready-result time, extended comparison | 3.50 seconds | 3.35 seconds |
| Sol median ready-result time, small comparison | 3.89 seconds | 3.84 seconds |

The same short fragment used 781 input tokens on both reduced models, about 92% fewer than the original request. Cached input is a subset of the original totals. Reduced requests in these runs reported zero cached input.

The quality checks use the existing `bench/inputs.mjs` predicates. They check specific expected corrections and preservation rules, not every aspect of writing quality. The extended Luna comparison did not score worse after removal. It still missed mixed-script preservation twice and added a period to one subject line. The original Luna configuration also made mixed-script and punctuation mistakes. These samples do not establish a general accuracy improvement or rule out smaller regressions.

The latency differences are small, and there were long outliers in both Luna configurations. No general speedup is established. No further requests, servers or benchmark processes remain running. No global settings or fleet configuration changed.
