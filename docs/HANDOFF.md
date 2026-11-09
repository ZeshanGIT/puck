# Puck product handoff (app repo)

Updated when product direction or alert presentation behavior changes. Vault `Projects/Puck/HANDOFF` remains the session log across repos.

## State machines (2026-11-09)

Implicit state machines were made explicit: `alert-lifecycle` (backend status writes), `app-session`, `alert-launch`, `pairing-flow`, `permissions-check`, `test-page`. Convention, inventory and generated diagrams are in `docs/state-machines.md`. No schema or wire format changed, so no Convex deploy is needed. Fixed on the way: stuck `freshSignIn` and inbox-cover latches, a launched notification alert that was never released (a later alert stayed under Needs you, or a blank screen), and the Working now ended-card timer. Not runtime-tested on a phone. Still implicit and listed in priority order in that doc: the answer attempt (A1, A2, A3, StackCard, AlertHost, StackHost), the client session, the ring lifecycle.

## Compact alert card over other apps and theme preference (t70u, 2026-11-08)

**Overlay card:** on an unlocked phone, a normal or urgent alert also shows a small Puck card drawn over the app in use (`TYPE_APPLICATION_OVERLAY`, native `OverlayCard.kt` in `puck-full-screen`). Tapping it opens Puck on that alert through the same opened-question route as a notification tap. Swiping it sideways or tapping Dismiss removes the card and stops its ring and voice; the alert stays in the shade and under Needs you. Snooze removes the card, stops the ring, and opens Puck on that alert's snooze choices. The snooze itself runs in the signed-in app, because `answers.snooze` needs the Clerk user; a card cannot snooze with the app closed. When the card shows, the ring uses card channels (`puck-alerts-card`, `puck-urgent*-card`) at DEFAULT importance, so no heads-up banner covers the card. The Sound settings rows open the plain channels, which still apply to locked phones and phones without the overlay permission. Locked phones keep the full-screen alert; calls get no card. The card hides when the ring ends or the alert is answered or cleared.

**Card gestures (2026-11-09):** drag sideways to snooze. The card slides aside and the length shows under it: 5 minutes after a short drag (12% of the card's width), 10 minutes after a longer one (38%), and until the person is back past 65%; a haptic tick marks each change. Lifting the finger picks the length showing, and a drag shorter than the first mark springs back and does nothing. Swipe up removes the card and stops the ring; the alert stays in the shade (same as Dismiss). Swipe down grows the card into a full-screen sheet in the card's colour (the card picture fades, corners square off), starts Puck half way through, holds, then fades onto the alert. Tap still opens it, and the Snooze button still opens the snooze choices. A timed card snooze opens Puck on that alert and saves the snooze at once (`cardSnooze.ts`, `AlertHost`); if it cannot be saved (offline, signed out) the snooze choices open with the error. Because `answers.snooze` is Clerk-only, a snooze still needs Puck to open briefly; saving it with the app closed needs the backend change in the vault HANDOFF.

**Permission step (the person grants it):** Puck → Settings → Preferences → "Show alert cards over apps" opens Android's "Display over other apps" page for Puck. The app declares `SYSTEM_ALERT_WINDOW` but never grants it or changes OS settings. Without the grant the card is not shown and the notification is the only alert on an unlocked phone, as before.

**Known limitations:**
- The notification still posts on an unlocked phone (sound, shade copy, heads-up), so a heads-up can appear next to the card. Removing it needs a channel-level decision.
- Mute is still not enforced on the headless push path (pre-existing); the card follows the same decision as the ring.
- Not runtime-tested by the agent. Card rendering, tap routing and the theme flip need the owner's device check.

**Theme:** Preferences → Appearance: System (default), Light or Dark. The choice is stored in local settings, applied at the app root, and survives restart. Light or Dark overrides the phone setting; System follows it. The urgent night look is unchanged.

**Release (t70u):** non-debuggable release APK with embedded JS, built from `main` at `9bf9c3e`, installed with `adb install -r` on the Pixel 7 (`versionName` 1.0.0, `run-as` denied). Still not store production-ready: debug keystore, dev Convex `usable-mule-44` and dev Clerk unchanged.

## Full-screen paging for all priorities (approved 2026-11-08, t56u)

**Direction:** Puck’s core value is full-screen paging, not shade-only notifications. **Normal** and **urgent** alerts both request full-screen presentation when the user has allowed “show over the lock screen.” Urgency stays distinct:

| | Normal | Urgent |
|---|--------|--------|
| Full-screen intent (when allowed) | Yes | Yes |
| Notification sound | `puck-alerts` channel, single sound | Urgent channels; insistent loop until timeout |
| Bypass DND / silent | Existing global **Urgent only / All / Off** — normal only benefits when set to **All** on channels that support it; normal never uses urgent bypass channels | Urgent channel matrix unchanged |
| In-app UI | Standard alert chrome | URGENT pill, rings, night look on lock screen |

**Not guaranteed:** Android may not show full-screen UI when the device is unlocked and the user is in another app; the app falls back to heads-up notification + tap. We do not bypass OS restrictions or grant permissions silently.

**Unresolved (no new defaults):** Dedicated normal-priority DND/silent bypass channels when global mode is **All** — today normal full-screen pushes still ring on `puck-alerts` (matches prior bypass QA). Extending bypass to normal without a separate channel design is deferred.

**Deploy:** Backend `fcmBody` change must be on Convex (`usable-mule-44`) for normal alerts to receive data-only full-screen pushes. App JS handles presentation on device.

**Main (t57u):** Merged to `main` at **e708869** (`f0cb3fa` + `e708869`). Convex `usable-mule-44` deployed 2026-11-08 ~01:08 IST. Feature branches kept on origin.

## Alert launch routing (t63u, main **be2b5c8**)

**Problem:** Normal lock-screen open could flash Home before the launched alert mounted (`openedId` async; deck fell back to `live[0]`).

**Fix:** `alertLaunchRouting.ts` — `pickDeckAlert`, `alertLaunchSettled`, `inboxShowsHome`. `Inbox` delays `onReady` and shows `Blank` instead of Home until the launch target settles or is known gone.

## Launcher icon (t66u, main **226f524**)

**Source:** `SAMPLE_BOTS.puck` / Home header blob (`puckBrandBlob.ts`, same shape/eyes as `Blob` in `H1Home`).

**Assets:** `app/assets/icon.png`, `android-icon-{foreground,background,monochrome}.png`, `puck-blob-icon.svg`. Regenerate: `bun run icons` from `app/`. **`expo prebuild --platform android`** before `assembleRelease`/`assembleDebug` so gitignored `android/.../mipmap/ic_launcher_*` reflects committed PNGs (CNG).

## Workflow (t69u)

Seshan authorized **2026-11-08:** Cursor agents commit and push **`main` directly** after tests/typecheck; no feature branch or review gate. Other rules unchanged (no automated on-device testing; preserve data on install; ask before invasive unlocked takeover / overlay work).

## Release APK (t64u)

**WorkManager crash (fixed):** SDK 58 release enables R8 (`android.enableMinifyInReleaseBuilds=true`). `WorkManagerInitializer` failed with `WorkDatabase.canonicalName` because R8 stripped Room/InputMerger reflective constructors (Notifee → `work-runtime`). Fix: `plugins/withWorkManagerProguard.js` + `work-manager-proguard-rules.pro` (Expo issue #52173 pattern).

**Build and install (t78u):** `bun run release:install` from the repo root builds the release APK and runs `adb install -r` on the Pixel 7, after the checks in the README ("Release APK on the Pixel 7"). Manual steps are unchanged: `expo prebuild --platform android --no-install`, then `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`.

**Not store production-ready:** same debug keystore as dev builds; `EXPO_PUBLIC_*` / Convex `usable-mule-44` / Clerk dev instance unchanged. `expo-dev-client` remains a dependency (release still non-debuggable with embedded JS).

**Install:** `adb install -r` only; preserve data.
