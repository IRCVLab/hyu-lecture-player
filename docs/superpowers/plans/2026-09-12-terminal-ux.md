# Terminal UX Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task, with test-driven-development and verification-before-completion.

**Goal:** Make the approved terminal player easy for a first-time recipient to install and operate.

**Architecture:** Keep the browser/auth/queue intact. Add dependency-free setup and pure presentation helpers. Extend the existing picker with a recommended per-course selection, then explicitly pass that selected list to the CLI. Preserve explicit manual options and JSON diagnostics.

**Tech Stack:** Node >=22, Bash/Windows launchers, node:test, existing Playwright fixtures.

### 1. Setup and launchers
Files: setup.mjs, run.sh, run.cmd, run.command, tests/setup.test.mjs, package.json.
- [x] Add failing tests for dependency-free setup checks, Node version, Chrome path/platform detection, headless Linux remedy, and launcher missing-tool/failed-install paths. Run `node --test tests/setup.test.mjs` and verify expected failures.
- [x] Implement pure environment diagnostics with injected environment/filesystem and executable runner. `--check` reports all issues and exits nonzero if unmet. Never install Node/Chrome automatically.
- [x] Add shell preflight checks, visible failures and macOS wrapper. Verify help/check before dependencies exist; no account data touched.
- [x] Rerun setup tests and launcher smoke checks.

### 2. Recommended selection and time estimate
Files: terminal.mjs, presentation.mjs, cli.mjs, tests/terminal.test.mjs, tests/presentation.test.mjs.
- [x] Test Enter recommendation separately for different course weeks, no pending videos, excluded unknown/future/expired dates, overdue warning, explicit confirmation/cancel, manual selection compatibility, and full-list toggle. Run targeted tests, verify failures.
- [x] Add a pure recommendation helper filtering open pending videos, ordered course/week. The recommendation returns `selected` in addition to existing plan fields; manual selection retains weeks and uses selectEntries validation before confirmation. CLI uses `plan.selected` when provided, otherwise existing selection.
- [x] Render selected counts and estimated full duration excluding completed rows; label missing durations and resume caveat. Re-prompt invalid manual schedules, rather than exiting after confirmation.
- [x] Run targeted tests; keep legacy parsing/abort contracts intact.

### 3. Readable status/progress/results
Files: presentation.mjs, options.mjs, cli.mjs, tests/presentation.test.mjs, tests/options.test.mjs.
- [x] Add failing tests for completed/running/interrupted/error/stale state, attendance distinction, missing fields and JSON flag validation.
- [x] Add human summary with selected/completed/pending counts, current title, playback position and next action; `--status --json` retains machine output. Final CLI output uses same formatter. Progress overwrites one TTY line; file logs and non-TTY output remain intact.
- [x] Clear stale previous progress when a new entry starts. Test pure renderer/output policy and run all tests.

### 4. Documentation and distribution
Files: README.md, package.json, npm-shrinkwrap.json, plan/spec docs.
- [x] Document extract/launch, prerequisites, first use, normal usage, --check, --status --json, failures and local data safety. Do not imply an unpublished release link exists.
- [x] Review code. Run `npm test`, `git diff --check`, `npm pack --json`; inspect allowlisted archive.
- [x] Extract to isolated temporary directory, run `npm ci`, launcher help/check and compare packaged sources; no actual login/playback.
- [x] Record verified tests/platform limitations and commit implementation. Do not publish remotely.

## Verified outcome (2026-09-12)

- 71 offline tests passed after final changes, including whole-CLI recommendation/final-verification flow and changed-before-playback schedule rejection.
- Spec and code-quality reviews approved after fixing completed-count presentation and inventory schedule handling. Inventory preserves unknown dates for display; fresh incomplete playback entries are strictly revalidated.
- Version 1.1.0 TGZ and ZIP each contain the same 25 allowlisted source/test files, byte-matched to the working tree. Private data and dependencies excluded.
- Isolated extraction: help/check worked without installed dependencies, npm ci succeeded with no audit vulnerabilities. Linux runtime checked; Windows/macOS launcher code and platform fixtures tested, native execution not verified.
- Actual lectures were not replayed or accessed during UX development. Existing completed queue state is preserved.
- Local branch retained; no remote publish, PR, merge or cleanup requested.
