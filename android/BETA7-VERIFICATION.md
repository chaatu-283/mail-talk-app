# v0.47 native beta7 verification

## Baseline and recovery

- Baseline main: `589b4461657faded52dc8dd25a2c695c57333b69`.
- Remote backup: `codex/backup-main-589b446-beta7`.
- Version remains `0.47-native-beta7`, versionCode `11`.
- Artifact: `MailTalk-v0.47-native-beta7-debug.apk`.
- Native `AuthorizationClient` remains the Gmail authorization path. No OAuth client/secret changes.
- `android/app/build.gradle` still explicitly uses the existing `~/.android/debug.keystore`.
- CI restores that exact cache and stops if absent. It must never generate a replacement key.
- The completed APK must pass `scripts/verify-apk.sh` before upload.

Expected package: `jp.chaatu.mailtalk`

Expected SHA-1: `90:E2:62:7B:E6:F7:58:F8:A9:9A:C4:DF:06:3A:B0:A4:A2:6A:6A:25`

Expected SHA-256: `0C:42:7E:A6:8F:F5:A3:5A:52:36:65:24:5B:0D:69:BD:60:E1:E9:14:97:20:A1:7F:40:EA:4B:40:F1:33:67:C5`

## Changes and limits

- API 33+ uses standard `OnBackInvokedCallback`; older Android uses the same handler through `onBackPressed`. Neither uses `WebView.goBack`.
- The JS handler returns true for attachment/chat/settings/compose/filter transitions, false at the root. Fixed incorrect single-element selectors in back/category/preview operations.
- Standard WindowInsets resize the WebView inside a padded FrameLayout, including system bars, cutouts and IME. No AndroidX Core dependency added.
- Existing period choices 7/30/90/180/365/730 and count choices 50/80/100/200/500/1000 retained. Pages are capped at 500, details at 10 concurrent requests with a 250ms pause between batches. Duplicate sync and repeated page tokens are blocked.
- Existing message-ID cache reuse retained; this is not a new Gmail history API implementation. 429/rate-limit responses pause further requests, honoring Retry-After. 401 refresh is shared and bounded to one retry.
- Reply editor has no border/separator and follows 46% of visual viewport height. Text drafts for new mail now survive returning to the list; existing reply drafts remain. Attachment selections remain session-only and must be reselected after leaving/restarting.
- Adaptive foreground (envelope, bubble, heart) scaled inside the central radius-33 safe zone. Existing pink background, SVG, splash and cute theme preserved.
- Native attachment export preserves filename/extension, grants read-only content URI access, and falls back to Android's save dialog. Native export is limited to 25 MB to bound WebView/base64 memory use; sending remains 5 files / 10 MB.
- Native JS confirmation dialog supports existing send confirmations. No live email was sent by automated checks.
- WebView still reads `https://chaatu-283.github.io/mail-talk-app/`; web changes must be deployed from main before testing the complete APK behavior.

## Automated evidence

Run `node --test tests/*.test.cjs` (mock Gmail, no live mailbox):

1. 1000 messages across two pages; max 10 simultaneous detail requests; cached resync does not refetch bodies; duplicate sync blocked.
2. A failed batch waits for outstanding requests and preserves previous cache.
3. Repeating page tokens terminate safely.
4. Concurrent 401 responses share refresh; retries are bounded.
5. HTTP 429 blocks subsequent calls for Retry-After.
6. Android Back state sequence: attachment → chat → list → clear filters → false; settings and compose → list.
7. Reply height respects reduced keyboard viewport and only scrolls for long content.
8. Different subjects with one correspondent remain grouped, incoming/outgoing in chronological order.
9. Japanese RFC2047 subjects, reply headers and original Japanese JWW filenames survive MIME encoding.
10. New-message text drafts survive leaving and reopening the editor.

These tests do not prove real-device UI, Google authorization or Gmail delivery.

## Real-device checklist — all pending for this revision

Do not label this build completed until results are recorded. Record phone model, Android version, navigation mode, APK build/run, timestamp and screenshot/error for each failure. Never record access tokens or mailbox contents in public logs.

| Test | Check | Status |
|---|---|---|
| TEST-01 | Update over installed version without uninstalling | Pending |
| TEST-02 | Pink icon visible; envelope/heart not clipped | Pending |
| TEST-03 | Native WebView starts without Chrome bar | Pending |
| TEST-04 | Existing Gmail grant usable after update/restart | Pending |
| TEST-05 | Sync succeeds | Pending |
| TEST-06 | Settings does not overlap Samsung three-button navbar | Pending |
| TEST-07 | Settings can be tapped | Pending |
| TEST-08 | Select 180/365/730 days | Pending |
| TEST-09 | Select 200/500/1000 messages | Pending |
| TEST-10 | Fetch >100 messages with a mailbox containing enough results | Pending |
| TEST-11 | Open a conversation | Pending |
| TEST-12 | Android Back returns to list | Pending |
| TEST-13 | Root Back backgrounds app, never navigates to initial URL | Pending |
| TEST-14 | Settings → Back → list | Pending |
| TEST-15 | Attachment → Back → original message | Pending |
| TEST-16 | Reply grows; keyboard and send button remain usable | Pending |
| TEST-17 | Reply arrives, with correct thread/headers | Pending |
| TEST-18 | Photo attachment sends and preview gestures work | Pending |
| TEST-19 | PDF renders; paging/pinch/pan/zoom work | Pending |
| TEST-20 | JWW opens in JW_cad Viewer with original filename; fallback save works without handler | Pending |

Also check new mail (subject-only/body-only/attachment-only allowed; completely empty blocked), Japanese subjects, five-file/10 MB limits, search/favorites/classification/themes and text drafts. Historical reports of JWW success do not constitute a pass for this modified native export.
