# Runtime benchmark verification

P00a adds 15 offline scenarios. Browser scenarios load an isolated copy of the built extension. The copied worker has only a native-message boundary stub prepended. Core scenarios call the real rewrite and stream functions or the real native host with a fake CLI. No real rewrite provider or user draft is used.

## Browser crash fix

Sandboxed Chrome launches caused macOS crash dialogs during delegate verification on 20 October 2026. The delegate was stopped. The shared launcher and Playwright configuration now reject the known macOS `CODEX_SANDBOX=seatbelt` restriction before launching Chrome. A regression test replaces the browser-launch boundary so that the test itself cannot launch Chrome. A shared browser setup failure blocks the remaining runtime scenarios. Interruption checks stop new sample work and close the owned session.

The original debugger startup method failed outside the sandbox because browser-level auto-attach requires the flattened protocol. The runtime copy replaces that method. The original `dist` stays unchanged. A warm rich-editor fixture also changes its final six-byte word so that each operation is eligible for an idle request. Byte and word counts stay constant.

## Verified locally

- Unit suite: 310 passed, 2 skipped across 25 files.
- Browser suite: 136 passed outside the sandbox.
- HTTP fixture and sandbox regression checks: 4 passed.
- Two smoke runs: all 15 scenarios and 30 samples passed per run. Source/build hashes, coverage, request/message counts, decoding counts, process counts, and ready-time liveness matched. Timing, polling, and heap observations are not required to match.
- Explicit sandbox Playwright invocation: rejected before browser startup.
- Interruption probe: SIGTERM during core work returned an incomplete report and started zero browser scenarios.
- Heap artifact check: each corrected smoke run retained four distinct snapshots with matching recorded sizes. A prior full run passed all 300 samples, but snapshot names overlapped. Its evidence is retained separately; the accepted baseline above was regenerated after the filename fix.
- Full baseline: [all 300 samples passed](../results/runtime-full-202610200817580300-63158.json), with ten cold and ten warm samples in each of 15 scenarios. The [raw samples](../results/runtime-full-202610200817580300-63158.samples.jsonl) are committed beside the report. All four snapshot files exist with their recorded sizes. Source/build hashes match both corrected smoke runs. The corrected full run finished at 2026-10-20T08:23:59+0300 in Africa/Cairo.
- Lint, typecheck, build, and formatting passed.

The successful smoke comparison is retained with the task's local review artifacts. Failed earlier reports are retained there separately and are not accepted baselines. Heap snapshots stay local or in CI artifacts; they are not committed.

## Interpretation and limits

Reports record source/build hashes, Cairo timestamps, environment details, raw samples, medians, maxima, and work counts. Cold browser samples use fresh profiles. Warm samples reuse the last cold session. The native host stays single-use in both cases. Timings include synthetic provider pacing and test-driver overhead. They do not measure real model latency.

Renderer-wide listeners and DOM counts do not identify exact extension retention. Content-world pending-work counters exclude work scheduled before instrumentation and worker internals. Exact extension listener counts and bundled Preact render counts are recorded as null with reasons. Heap snapshots can trigger garbage collection. Neither timings nor heap bytes act as universal CI deadlines.

CI runs HTTP fixture checks and smoke after its build/browser install, with a three-minute smoke limit. Reports, raw samples, and heap snapshots upload through the pinned artifact action. Remote execution and artifact upload await the first push. Linux and Windows verification remain separate from the local Mac evidence.

The reviewer applied the test and documentation checks. The named Comment Sicko agent is unavailable in this environment, so that specialized pass is skipped; comments are reviewed manually. Reusable skill suggestion from Sol: browser sandbox preflight. Reviewer view: add the rule to the existing delegation guides instead of creating a separate skill.
