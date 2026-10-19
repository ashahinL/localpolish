# T19c: align the options idle checkbox

The owner reported the Defaults checkbox is floating in the middle of its column. The options text-input rule sets width: 100% on every input, including the checkbox. The native check mark appears in the center of that stretched box.

- Keep the existing checked state and save behavior.
- Exclude checkboxes from the text-input styling.
- Place the checkbox beside its label in a compact flex row, with the help text below. Keep the label clickable and associate the description for screen readers.
- Check the built options page in light and dark mode and on a narrow screen. Run the existing toggle-save browser tests and normal final gates with the T19 usage integration.
- No version bump. One task commit. Keep the plan current. Follow implement-plan in the same light form as this plan.
