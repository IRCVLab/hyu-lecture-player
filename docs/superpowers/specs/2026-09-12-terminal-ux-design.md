# Beginner-friendly terminal UX

User approved on 2026-09-12: retain the terminal application; improve installation guidance, course selection, pending-week recommendations, estimated playback time, and readable progress/results. No standalone GUI or automatic system installation. Preserve sequential normal playback, server completion verification, and private-data exclusion. Existing real lecture queue is complete; do not replay it to test UX.

## Design
- Launchers explain missing Node 22+/npm and dependency installation failures. Windows keeps actionable failures visible; macOS gets a double-click `.command` launcher. No silent privileged installation.
- A dependency-free setup check reports Node, Chrome availability, and Linux desktop availability with specific remedies. `--check` is read-only and works without Playwright installed. Help/status do not launch a browser.
- Course picker remains numbered and supports multiple choices. Show open incomplete weeks first, hide future/completed rows behind an explicit details command. Enter recommends only playable pending weeks independently per selected course. Unknown dates, future/expired videos are not recommended. Overdue-but-playable videos carry an attendance warning. Manual common-week selection remains compatible and errors are recoverable before playback.
- Before explicit confirmation, show per-course weeks, pending count, already-completed count and full-length time estimate excluding completed videos. Explain that resume can shorten it and missing durations make the estimate partial. No automatic playback merely from selecting a recommendation.
- Human-readable `--status` and completion summaries distinguish completed learning from attendance and show interruption/error recovery. Preserve structured output as `--status --json` and existing private JSON status. Raw state/account details are not printed by default.
- Keep durable detailed logs; show concise progress in an interactive terminal without flooding scrollback. Changes must not affect playback timing or verification.
- Rewrite quick start around download/extract/launch, first-login privacy, normal usage and targeted troubleshooting. Be honest that Linux is tested and other OS launchers are not runtime-verified here.

## Verification
Offline unit/integration tests for selection, prompts, setup, duration and result rendering; full existing media/auth suite; isolated archive install and launcher check/help. No real lecture playback for UX testing. No credentials or browser profiles in distributable archive.
