# HYU browser lecture player

User approved visible-browser automatic playback and next-video navigation.
Scope: course 220341 and the enrolled probability/statistics course; weeks 1 and 2 initially, and reusable execution for the current or explicit weeks.

Use Playwright with a separate persistent Chrome profile. Authenticate through the LMS login page, informed by HYU-course-registration's credential and RSA login flow. Never run registration operations. Keep credentials and browser state out of version control and logs.

Discover courses and weekly video entries from actual LMS pages. Select the current week from published schedule dates; fail clearly if ambiguous. Support explicit --weeks 1 2, --list, and default visible playback. Play one video at a time at normal speed using the site's player. Advance after genuine ended state, verify recorded completion where exposed, and rediscover server progress on restart. Do not synthesize attendance requests or fast-forward videos. Stop with a clear message for authentication failure, unknown player layout, or persistent playback stall.

Deliver a launcher, Korean README, bounded selection tests, and browser tests using real local video elements. Verify real login, both course inventories, initial playback, and eventual transitions/completion when observable. Distinguish video ended from LMS completion and report unverified states honestly.

## Approved distribution requirements

Discover enrolled student courses dynamically, with term/year from LMS. Default launch is a Korean terminal selection flow: account login/selection, course selection, weekly pending/completed counts and deadlines, week selection, 보기. Multiple selected courses remain strictly sequential, one video only. Explicit noninteractive options support repeatable scripted runs. No user-specific IDs, credentials, or semester in distributed source. Local private credentials are saved only after verified login. Distribution target is HYU LearningX as observed; no promise of other universities/LMS adapters.

## Final goal explicitly expanded by user

Finish the distributable program AND run all currently required incomplete videos for the two requested courses, weeks 1 and 2, strictly sequentially. Completion requires fresh final LMS inventory showing 완료 for every selected video; attendance remains a separate field, especially overdue probability/statistics week 1. Starting a process or passing tests alone does not finish this goal. Already-completed entries must never be replayed automatically. Persist a live process handle and per-video verified results until the final audit.
