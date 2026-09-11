# HYU browser lecture player

User approved visible-browser automatic playback and next-video navigation.
Scope: course 220341 and the enrolled probability/statistics course; weeks 1 and 2 initially, and reusable execution for the current or explicit weeks.

Use Playwright with a separate persistent Chrome profile. Authenticate through the LMS login page, informed by HYU-course-registration's credential and RSA login flow. Never run registration operations. Keep credentials and browser state out of version control and logs.

Discover courses and weekly video entries from actual LMS pages. Select the current week from published schedule dates; fail clearly if ambiguous. Support explicit --weeks 1 2, --list, and default visible playback. Play one video at a time at normal speed using the site's player. Advance after genuine ended state, verify recorded completion where exposed, and rediscover server progress on restart. Do not synthesize attendance requests or fast-forward videos. Stop with a clear message for authentication failure, unknown player layout, or persistent playback stall.

Deliver a launcher, Korean README, course configuration, bounded selection tests, and browser tests using real local video elements. Verify real login, both course inventories, initial playback, and eventual transitions/completion when observable. Distinguish video ended from LMS completion and report unverified states honestly.
