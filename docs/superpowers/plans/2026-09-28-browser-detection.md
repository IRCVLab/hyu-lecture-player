# Browser Auto-detection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, as requested by the user.

**Goal:** Run an installed Chrome, Edge, Brave or Chromium without a browser-selection prompt.

**Architecture:** Dependency-free setup discovery returns executablePath, browserId, browserName and profileDirectory. CLI consumes those values with the existing Chromium launcher; playback is unchanged.

**Tech Stack:** Node.js built-ins, Playwright, node:test.

## Task 1: Discovery

- [x] Add failing tests in `tests/setup.test.mjs` for all four browsers on Mac, Windows and Linux; user app directories; vendor precedence; missing/inaccessible/non-file candidates; absolute-only PATH directories; no-browser output. Inject stat alongside access for simulated filesystems.
- [x] Run `node --test tests/setup.test.mjs`; confirm new assertions fail before implementation.
- [x] Replace `chromeCandidates` in `setup.mjs` with ordered browser definitions. Enumerate standard app paths and known Linux names; deduplicate candidates and test access plus stat.isFile(). Return metadata for the first executable; use check ID `browser`. Never shell out or download anything.
- [x] Chrome returns profileDirectory `profile`; other IDs return `profile-${browserId}`. Missing browser returns undefined executable and metadata, with concise installation guidance.
- [x] Run setup tests again; expect all pass.

## Task 2: Launch integration

- [x] Extend `tests/cli.test.mjs` offline fixture to supply browser metadata and assert exact executable path, isolated profile suffix and visible mode for each browser. Check startup labels, launch-error label, and absence of a browser-selection prompt.
- [x] Confirm failures with `node --test tests/cli.test.mjs`.
- [x] Update `cli.mjs` to show browserName, use profileDirectory and executablePath, and wrap launch failure with the browser name and actionable install/close guidance. Do not retry other browsers after launch failure.
- [x] Run CLI tests; expect all pass, including release of lock on launch failure.

## Task 3: Docs, review and publication

- [x] Update `README.md` concisely: supported auto-detection; Mac app folder guidance; Brave/Chromium best-effort, not validated on real LMS. Keep Node requirement.
- [x] Run `npm test`, `git diff --check`, `node cli.mjs --check` and `npm pack --dry-run`. Check package excludes private data.
- [x] Review scoped changes for safety and regressions. No real LMS login or lecture playback.
- [ ] Commit only scoped files; push `HEAD:main` without force; verify remote SHA. Report if authentication expired, without asking for secrets.
