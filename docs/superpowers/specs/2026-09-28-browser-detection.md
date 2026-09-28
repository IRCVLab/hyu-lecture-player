# Installed browser auto-detection

## Scope and UX

Replace Chrome-only detection with deterministic installed-browser selection:
Chrome → Edge → Brave → Chromium. No new menu, background download, or default
browser change. Display the chosen browser on startup and in `--check`.
Safari, Firefox, Opera and other unlisted browsers are outside this change.
Brave and system Chromium are best-effort targets: discovery does not certify
LMS playback or codec compatibility. Do not claim macOS/Windows live validation
from simulated platform tests.

## Discovery and launch

Keep dependency-free discovery in `setup.mjs`. Return executablePath plus stable
browser ID and display name. Search each browser's candidates before moving to
the next browser, de-duplicating paths. Require an executable file on Unix and
a file on Windows; skip inaccessible candidates. Never execute discovery paths
through a shell.

- macOS: standard app bundles in `/Applications` and user `~/Applications`.
- Windows: standard vendor directories under ProgramFiles, ProgramFiles(x86)
  and LOCALAPPDATA; skip missing environment roots.
- Linux: standard binary locations, `/opt` vendor locations, and absolute PATH
  directories for known executable names. Ignore relative/empty PATH entries.
- No recursive disk scans, Spotlight dependency, registry discovery or arbitrary
  app-name guessing. Custom installs outside these locations remain unsupported.

Launch the selected executable using the existing visible Playwright Chromium
context. Preserve Chrome's existing `.private/profile`; use separate
`.private/profile-edge`, `profile-brave`, and `profile-chromium` for alternatives.
Never use a user's everyday browser profile. Keep shared encrypted credentials,
run locking, sequential playback and LMS completion checks unchanged.

Discovery fallback applies only to missing/unusable candidates, not launch or
login failure. If the chosen browser fails to launch, stop with its name and
actionable guidance; do not silently launch another browser or reset profiles.
If none is found, explain which browsers are supported and link Chrome install
guidance. `--check` must not open a browser, download software or write data.

## Verification and documentation

Test all four browsers across simulated Mac/Windows/Linux layouts; priority,
user installs, paths with spaces, missing/inaccessible/non-file paths, absolute
PATH handling, no-browser guidance, selected-browser labels and profile paths.
Keep help/status dependency-free. Run the existing offline suite; do not log
into the real LMS or play lectures during verification. Update README briefly
with supported browser detection and best-effort limitations.
