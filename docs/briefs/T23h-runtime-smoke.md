# T23h. Restore the runtime smoke checks

The current GitHub test workflow fails before its core runtime probes run. Reproduced locally: importing the compiled rewrite module throws `Cannot find module './outputBudget'`.

1. Add `src/background/outputBudget` to the runtime compiler's existing module list. Keep the source module unchanged.
2. Run the real synthetic core probes, the fixture checks, and runtime smoke through a local browser. Use only fake CLIs and the mock provider.
3. Run lint and formatting. Review the small diff, record results in the plan, and commit this task separately.
4. Pull with rebase, push, and check the GitHub test workflow. Run the platform workflow required before release. Leave manual release checks open.

Follow implement-plan in light form: build, test, keep the plan current, report. No new dependency or browser-setting change is needed.
