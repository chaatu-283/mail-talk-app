# v0.47 native beta9 — foreground automatic sync

Baseline main: `b3035c200d884f9239fbe461efc1e61ce60b2bca`.
Backup: `codex/backup-before-auto-sync-b3035c2` (local and GitHub).
APK: `MailTalk-v0.47-native-beta9-debug.apk`, versionCode 13.

## Behavior

- Cache and UI render first. Startup/resume sync is scheduled 800 ms later.
- One five-minute timer runs while visible. Native onResume/onPause and browser visibility/page lifecycle share the scheduler.
- Both manual and automatic sync use the existing in-flight guard, 65-second cooldown and Retry-After limit. Failed attempts and empty mailboxes also observe cooldown. Manual force does not bypass it.
- Native automatic auth only runs after a recorded successful grant and uses AuthorizationClient without launching a resolution UI. Use the manual sync button for initial connection or renewed consent.
- Browser auto sync needs a configured client and a valid in-memory access token. After reload/expiry, manual sync is required; no unsolicited OAuth popups.
- Automatic errors appear in the small status line. No no-new-mail toast. New mail count appears in status.
- Only list/filter DOM is refreshed automatically, retaining the visible row/scroll offset. Open reply, compose, settings and attachment views are not reconstructed. Reopen an active conversation to see newly synced messages there.
- Hidden applications stop scheduling and stop before subsequent API requests/batches. Already submitted requests may finish; no partial cache replacement.
- Pagination (500 per page, maximum 1000), cached bodies, detail batches of 10 and rate-limit handling remain.
- Existing fixed keystore, package, back/insets, supplied blue icon, sending and attachment code remain.
- No closed-app background service or push notifications.

## Automated verification

`node --test tests/regression.test.cjs`: 16 tests pass locally, including timer lifecycle/debounce, quiet sync, cooldown on empty/error responses, retry recovery, silent native auth, leaving foreground, 1000-message pagination, concurrency <=10, token refresh/429, back flow, reply height, MIME/JWW filenames and drafts.

JavaScript syntax and diff whitespace checks pass. Android compilation and completed-APK signature are checked by GitHub Actions, not by signing with a local replacement key.

## Device verification — all pending

No physical Android device is connected to this task. Automated mocks do not verify Gmail or device behavior.

| Test | Required observation | Status |
|---|---|---|
| 01 | Cached messages appear immediately on launch | Pending |
| 02 | Automatic sync follows launch | Pending |
| 03 | Incoming mail appears without pressing sync | Pending |
| 04 | Returning from another app syncs (after cooldown) | Pending |
| 05 | Foreground sync after five minutes | Pending |
| 06 | Repeated manual taps do not overlap sync | Pending |
| 07 | No repeated empty-result toast | Pending |
| 08 | Offline does not crash or erase cache | Pending |
| 09 | Next eligible sync recovers after reconnect | Pending |
| 10 | Manual sync still works | Pending |
| 11 | Native Google authorization survives update/relaunch | Pending |
| 12 | Reply, send and attachments work | Pending |
| 13 | Android Back returns correctly | Pending |
| 14 | Settings remains above system navigation bar | Pending |

For failures record APK version, device/Android version, time, steps, screenshot and sanitized log. Do not mark these tests passed without device evidence.
