# Arrow-key terminal menus

**Approved design:** The user explicitly approved arrow navigation, Space multi-select, Enter confirmation, and automatic highlight, initial focus and preselection of currently needed weeks. Completed/future/expired/unknown-only weeks remain visible but disabled; overdue playable weeks have warning labels. Keep normal sequential playback and LMS completion checks unchanged. No real lecture playback during this UI task.

**Architecture:** Dependency-free reusable key menu in key-menu.mjs. terminal.mjs routes capable TTYs to an arrow-key course/week/confirmation wizard and retains line-input fallback for redirected/noninteractive terminals. Account identity selection uses the same single-selection menu. Pure state/model helpers plus real streams and a manual PTY smoke check exercise input, cancellation and terminal cleanup.

**Interaction:** Course Enter chooses checked courses, or focused course if none checked; Space permits multi-selection. Week rows represent individual course/week pairs. All open pending eligible weeks initially checked, focus first in-deadline pending week (overdue-only as fallback); markers/colors persist independent of focused row. Completion and future states disabled. Week Enter with no checks does not silently reselect. Explicit final 보기/취소 menu before playback.

- [x] Write failing widget tests: arrow navigation, multi/single selection, defaults/focus, disabled rows, zero checks, Esc/Ctrl-C/abort/EOF, raw mode/cursor cleanup and bounded viewport. Implement and verify.
- [x] Write failing terminal-model/wizard tests: multi-course different weeks, prechecks, current focus ahead of overdue, invalid dates, selection summaries, cancellation, fallback compatibility. Integrate accounts without numeric prompts on TTY.
- [x] Update help and README to make arrow menus the normal path; bump package version and lock metadata.
- [x] Review implementation, run full offline suite, manually exercise in a real PTY without LMS access, and audit rebuilt ZIP/TGZ in isolated extraction.

Owned files: key-menu.mjs/tests/key-menu.test.mjs for widget worker; terminal.mjs/cli.mjs/tests/terminal.test.mjs/docs/package for parent. Existing independent feature branch retained; no remote publishing or account playback.

## Verification

2026-09-16: all 92 offline tests passed. Spec/code-quality review approved after making disabled rows browsable without selection and preserving inactive stdin on cleanup. Actual PTY wizard confirmed default checked/focused week 3, disabled future-week toggle rejection, explicit final confirmation, selected result [3], and clean exit code 0. No live LMS access or actual video playback during this task. Version 1.2.0 ZIP/TGZ each contain 28 allowlisted files byte-matched to source; private data excluded. Isolated extraction help and npm ci succeeded. Native Windows/macOS runtime validation remains outside this Linux environment. Local branch retained; no remote publish.
