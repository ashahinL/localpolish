# Performance candidate verification

Code candidate: `a7efd78148228ee19f2845a1882012279175ffe3`. The version stays 1.1.0. No release was published.

## Checks

- Lint, typecheck, formatting and build passed.
- Unit tests: 498 passed, two existing skips. The Windows fixture correction also passed its targeted test locally.
- Browser tests: all 177 passed. The first invocation lost an old reused Vite fixture server. The complete rerun started its own server and passed.
- Dependency audits: zero vulnerabilities, both full and production-only.
- Runtime: all 300 samples passed, ten cold and ten warm samples for each of 15 scenarios. Four unique heap snapshots were retained locally.
- [Normal CI](https://github.com/ashahinL/localpolish/actions/runs/39482982092) passed on the code candidate.
- [Platform CI](https://github.com/ashahinL/localpolish/actions/runs/39483001955) passed on that same commit: macOS bridge, Windows bridge and Linux Node 22 gates.
- Earlier Windows CI found a malformed fake CLI wrapper. Task P13a corrected one path separator. Production host behavior did not change.

## Measured work

The [comparison report](../../bench/results/p13-runtime-comparison.json) retains the sample counts, matched environment fields, medians, maxima and exclusions. Both runs used the same Apple M4, OS, Node, Playwright and Chromium versions.

| Observation | Before | Candidate |
| --- | ---: | ---: |
| Preview messages for a 1,000-chunk idle answer | 1,000 | 0 |
| Immediate geometry reads during a 100-event selection burst | 100 | 0 |
| Total settled geometry reads for that burst | 101 | 1 |
| Idle timers after typing with idle disabled | 20 | 0 |
| Rich-marker text reads in the 900 ms window | 6 | 3 |
| Native checks when opening the three API-provider pages | 3 | 0 |
| Page-settings reads after a model-only save across five frames | 5 | 0 |
| Active held stream after its connection-test page closes | 1 | 0 |

These counts were the same across all 20 samples of each corresponding scenario. The native frame fixture kept the same bytes and fragment size. Its cold median dropped from about 89.04 ms to 5.55 ms and warm median from 72.63 ms to 4.18 ms. Repeated prefix concatenation was removed; the candidate measures direct copies separately.

The 1,000-chunk core rewrite probes became slower by fractions of a millisecond while output limits were added. Fewer messages do not prove a faster core callback loop. SSE now uses a different bounded aggregate fixture, so its total time is excluded from direct comparison. The idle-off scenario adds a blocked-site leg, so its total time is excluded too. The reports do not claim faster model replies or lower battery use.

Across 60 observed open/close cycles, popup nodes were zero after close, roots stayed at most one, and observed pending work was zero. Those counters cover work scheduled after instrumentation. Renderer-wide listeners and GC-dependent heap sizes do not prove an exact extension leak count.

## Packed artifact

`npm run pack` produced `dist/localpolish-1.1.0.zip`. SHA-256: `daa02119464b3f2c50159ecbe2637b618253d5ea894959d7bc4d4f4c19ac4d30`.

Every extracted file was checked against its zip entry. The unchanged extracted extension was loaded in a fresh Chrome profile. A local mock and fake key were configured. [Package results](../../bench/results/p13-package-verification.json):

- Test connection returned `This is a test sentence`.
- Rewriting `this are a test sentence` and accepting produced `This is a test sentence`.
- Backspace removed the final `e`. Undo restored it. A second Undo restored the original draft.
- Those checks passed for textarea, plain contenteditable, Draft.js, Slate, ProseMirror, Quill and Lexical, using each editor's actual text state.
- Blocked cross-host and srcdoc editors sent zero requests. After unblocking, a fresh edit sent one request.
- Usage matched nine local starts: one connection test, seven editor rewrites and one unblocked-frame idle request. No page exceptions were recorded.

## Known limits

Quill merges typing and paste within its one-second history window. A rapid typed draft followed by Accept can therefore undo back to the empty field. This was reproduced with Quill paste **without LocalPolish**. With a 1.1-second pause before replacement, Undo restores the draft. The package check uses that pause, and another pause before Backspace, to test distinct history steps. This behavior is recorded, not fixed or hidden as a passing fast-interaction case.

There are no new live Luna or Sol measurements. The [P12 lifecycle report](../../bench/results/p12-lifecycle.json) uses injected delays and fake CLIs. Windows browser UI and slower hardware were not measured; Windows native bridge CI passed. GitHub emitted non-blocking annotations about the Ubuntu runner image transition and the upload-artifact action's Node runtime.

Raw candidate reports, heap snapshots, package scripts and logs are retained in the local fleet artifact directory at `/Users/ashahin/.codex/visualizations/2026/10/20/localpolish-performance-fleet`. The full runtime report is `P13-runtime/runtime-full-202610202223280300-56233.json`.
