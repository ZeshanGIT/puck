# Puck product handoff (app repo)

Updated when product direction or alert presentation behavior changes. Vault `Projects/Puck/HANDOFF` remains the session log across repos.

## Faster alert opening (2026-11-18)

Opening an alert from the floating card or the lock screen no longer waits for history and the waiting list: the white cover fades once the alert itself can be drawn, and never before Android's own app-opening animation has ended (`MainActivity.onEnterAnimationComplete`, wired by `plugins/withFullScreen.js`), so that animation stays hidden. If Android never reports it, the cover goes after 1 s. The first launch after an install is a cold start and can flash; test after opening Puck once. Seshan confirmed both opens are much faster. The "Connecting" screen on the lock screen is still there. An earlier attempt to draw the alert from the push while the inbox loads is parked in `git stash` (it flashed a blank avatar screen and then "Connecting" on card taps).

## Show floating card button (2026-11-16)

The live notification's "Show floating card" button was opening Notifee's `NotificationReceiverActivity`, which threw inside EventBus (`getClass()` on null) before any JavaScript handler ran, so `LiveFloat.restore` never happened. The button now sets `launchActivity` to `puck.fullscreen.ShowFloatActivity`: an invisible activity that calls `LiveFloat.restore` with the last saved update and finishes. Notifee still stacks its own receiver activity on that press (translucent, no history); the card comes back from ours even when that event fails. A notification posted before this build keeps the old button until the next live update. Release installed 12:39 IST, then rebuilt from `main` at `250646c` and installed again at 12:59 IST (data kept). Seshan checked the 12:39 build at 12:53 IST: hide and bring back works.

## Bots with no webhook (2026-11-16)

`puck add --no-webhook` pairs without asking for a webhook (refused if `PUCK_WEBHOOK_*` are set). `validatePairingInput` takes both webhook fields or neither; none stores them as `""`, like the built-in bot. `deliveryRoute` returns `"none"` for such bots, and answers and snoozes are marked delivered with no attempt (`puck answer` prints `delivery: none (no webhook)`). `updateWebhook` still needs both. `bots.list` has `hasWebhook`; B2 Details shows "Answers". The CLI is linked at `~/.local/bin/puck` on the Mac. App row needs the next APK install.

## `puck send --wait` (2026-11-16)

Opt-in waiting in the CLI (`waitForAnswer` in `cli/src/commands.ts`): polls `GET /alerts/<id>` every 3 s, prints the `puck answer --json` view, exit 0 answered, 3 snoozed, 4 cancelled, 5 timed out, 1 error (5 failed checks in a row). `--timeout` (default 30m) and `--through-snooze` need `--wait`. Id on stderr first. Relaxes the 2026-10-28 webhook-only decision (vault DECISIONS). Not yet run against the live server. Since 30111b0, `GET /alerts/<id>` (so `puck answer` and `--wait`) also returns `snoozedUntil` while snoozed and the answer's `attachments` with download URLs, as the webhook does.

## Bot avatar shape and colour (2026-11-16)

`puck add --shape round|squircle|hex|bean|cloud` (with `--colour`), checked before the webhook prompts. `BOT_SHAPES` in `@puck/shared`; the backend stores `bots.shape`, returns it from `bots.list` and `pairingRequests`, sends it in the pairing push, and `bots.update` changes it (Convex dev pushed 2026-11-16). B2 has a Shape row above Colour. Alerts carry only the bot id, so `ui/botLookStore.ts` remembers each bot's colour and shape from `bots.list` (Inbox), saves them in SecureStore for a headless card (`loadBotLooks` in `showCard`), and `botLook` uses them after explicit values; `useBotLook` redraws on change. Before this, alerts, Home, the stack and the card ignored the chosen colour. Release installed 09:42 IST; owner check pending.

## Bottom card with an answer picker (2026-11-15)

`OverlayCard` shows at the bottom (gravity BOTTOM, above the navigation bar). Swipe up opens `Picker`, a full-screen touchable window with the answers above the card; `hover(rawY)` picks the one under the finger, risky ones need `HOLD_MS`, letting go calls `pickAnswer` (ring stops, "Sent to" with Undo for `UNDO_MS`, then `submitReply` with `optionIds`). Swipe down sends `ACTION_LATER` (`laterCardAlert`: settle, reminders kept). Answers come from `cardChoices` via `fetchCardChoices` (`alerts.get`) after the card shows, handed over with `setOverlayChoices`; the push has no options. `ensureBackgroundAuth` signs Convex in from the stored account when the app has not, so card answers send with Puck closed. `setRoom` and the pull-down-to-open are gone. Owner check on the phone pending.

## Puck plays the ringtone (2026-11-15)

The ringtone was the alert notification's channel sound, and Android's single notification sound player let any later notification cut it off. `RingService` (module manifest: foreground service type `mediaPlayback`) plays it with `MediaPlayer` on the ringtone or alarm usage with transient focus; it plays once or loops for the ring time, and shows a silent `puck-ringing-now` notification with Stop. JS (`startRinging`) decides with `puckRing(decision, soundPolicy())` (`ringPlayback.ts`), starts it with `startRing`, and posts the alert on a `-quiet` channel; `stopRing` runs in `forget`, `settleNow`, a press, and `OverlayCard.silenceNotifications`. No policy (older build) or a refused service: the old sounding channel. Reminders still use sounding channels. Verified on the Pixel with Puck in front only.

## Alerts by kind: bypass and reminders per section (2026-11-15)

Alerts (S4) and the bot page (B2) are one section per kind of alert: full screen while in use, ringtone, Repeat, ring through Do Not Disturb, ring in silent mode, Remind me. `BypassMode` gained `"normal"` so any combination of the two switches is one stored value (`modeAllows`, `withModeFor`, `followAppFor` for a bot's per-kind reset). Normal alerts now bypass when asked and allowed: `normalChannelId` gives `puck-alerts-dnd`, `-alarm`, `-bypass`, and `ensureChannel` builds both kinds; before this, `alertRingingPlan` ignored bypass for normal alerts entirely, so "All alerts" only ever applied to urgent ones. Reminders: `reminderMinutesNormal` (default 0) and a per-bot override; `reminderMinutes` stays the urgent one; reminders are scheduled for both kinds. Owner check on the phone pending.

## Card or full screen while in use (2026-11-15)

`fullScreenNormal` and `fullScreenUrgent` in local settings (default false, the card), with per-bot overrides read by `fullScreenFor`. `inUsePresentation` picks card, full screen or neither from the card's conditions; full screen calls native `openAlertFullScreen` (`OverlayCard.openFullScreen`, the card tap's opening without the card), falling back to the card if refused. The ring uses the quiet-banner channel either way. `openApp` waits two frames after adding a new cover before starting Puck. Switches: Alerts (S4, renamed from Alert sounds) and the bot page (B2) sound sections. The overlay permission is no longer a Settings row: it is the Alert health check `overlay` ("Show over other apps", from `usePhoneStates`), counted as a problem. Owner check on the phone pending.

## Card shadow, edge, font and pull-down (2026-11-15)

The pull-down used to drop the card by a status bar's height and show the reply field in its place, then snap back on cancel. Causes: the full-screen sheet window that draws the pull was fitted below the status bar (Android 11+ fits windows to system bars unless `fitInsetsTypes = 0`; `FLAG_LAYOUT_IN_SCREEN` no longer does it), while the card copy was placed by screen position; and the reply area stayed visible behind the card after a right swipe sprang back. `fullScreenParams()` now opts the sheet and the opening cover out of insets and cutouts, the copy is placed relative to the sheet's measured position (logged once per pull under the `PuckCard` tag), the copy follows the finger as it grows and eases back on cancel, and under-card layers are shown only by their own gesture. The shadow was clipped by the root view's `clipToPadding`; it is now off, with 20 dp room, 10 dp elevation and a 1.5 dp edge (`overlayPalette().edge`, `#AARRGGBB`). The card uses Nunito from `modules/puck-full-screen/android/src/main/assets/puck-fonts/` (Bold, ExtraBold, Black; OFL), falling back to the system font. Dev build installed on the Pixel; owner check on the phone pending. The upward swipe still resizes the card window mid-drag (`setRoom`).

Follow-up: Android 12+ draws a touch-through overlay (`FLAG_NOT_TOUCHABLE`) at no more than 80% opacity, which made the sheet see-through. The sheet and the opening cover are touchable now; `guardCover` swallows touches while they animate and removes them on a touch afterwards. The pull finishes and cancels on a spring (`Spring` interpolator), a tap runs the same growth without moving down, and the sheet keeps the edge and shadow until the last 15%, ending at the screen's corner radius.

The picture inside the sheet is the card's content only (no background, no blob); the sheet draws the wash and the single edge. The blob is a live `BlobView` above the sheet that flies on the same spring to the alert's blob: `AlertFrame` reports its blob box with `reportAlertBlob` (not over the lock screen), native keeps it in SharedPreferences and falls back to AlertFrame's default place, and `takeOverlayBlobFlight` makes the alert skip its arrival bounce once.

Puck is launched two frames after the sheet is placed: an overlay window added during Android's app-opening transition stays hidden until it ends, which made a tap open the alert with no visible animation.

## Alert sounds and reminders (2026-11-15)

Behaviour is decided in the vault: `Projects/Puck/docs/Alert sounds and reminders.md`. Alerts now play a ringtone from the phone's ringtone collection instead of a notification tone. Normal and urgent have their own choice, a bot can have its own, and each kind of alert has a Repeat switch (off: the ringtone plays once to its end). Ringing channels carry the ringtone in their id, because Android fixes a channel's sound when it is created; `removeStaleRingChannels` deletes the ones no choice uses. An urgent alert that gets past silent mode rings on the alarm stream, at the phone's alarm volume. Puck never changes the phone's volume.

An unanswered urgent alert reminds (Off, 2, 5, 10 or 15 minutes; default 5; per bot) with up to 12 notifications scheduled through Notifee when it rings, so they come with the app closed. Answering, snoozing or dismissing cancels them.

The card no longer shows while Puck is on screen, while the screen is off, or while locked, and it goes away when Puck comes to the front (`Presence` and `isAppInForeground` in the native module). Settings lost its Preferences screen (Appearance and Alert cards over apps are on the home list). Alert health has an optional "Unrestricted battery use" row that warns but does not count as a problem. The "Urgent rings for" setting is gone; an alert's own `ringSeconds` still bounds its card, voice and a repeating ringtone.

Checks: typecheck, 957 tests. Built as a debug build and installed on the Pixel; the sound behaviours still need the owner's checks on the phone (silent, Do Not Disturb, reminders, repeat, per-bot ringtones, battery row).

## Release trial and card opening (2026-11-11)

The single-choice alert is the acceptance target for the owner's bot trial. A release APK with embedded JavaScript was installed with `adb install -r` on the Pixel, preserving data. All 923 unit tests and workspace typechecks passed; existing app-wide lint failures remain. The normal single-choice question appeared full-screen while locked. The final release was installed at 05:01:58 IST. The unlocked card showed the question, tapping it opened that same question with no Home flash in the captured transition, and tapping Yes twice stored the answer and delivered its webhook on the first attempt. A cold launch can still show Puck’s opening/connecting screen; this is not a guarantee of instant cold startup.

Card layout now emphasizes the question, with a smaller avatar, lighter wash and short entrance. A native opening cover waits for React's requested-alert readiness acknowledgment; pending opens can be peeked without consuming them during render. Stale held alerts no longer override a newer live launch. Overlay drawing reports its actual asynchronous result and falls back to a high-importance notification on refusal. Presentation/clear operations are serialized per alert with cancellation invalidation. Push registration retries on foreground.

The existing development Convex deployment has bounded per-target transient alert-send retries and an explicit five-minute push relevance window, capped by a real alert expiry. The alert remains in the inbox after that window; old pages are not kept by FCM for days. Dismissals remain best effort to avoid a delayed snooze dismissal clearing a resumed alert. Already accepted out-of-order FCM messages are not fully reconciled across process death.

Phone scripting is documented in `docs/phone-testing.md`; `bun run phone -- <command>` runs the physical-Pixel helper. Unlock credentials stay in a private local file outside the repo. The owner's phone was set to Silent with notification volume zero and stay-awake while charging enabled. Battery Saver was off; Puck was not on the device-idle whitelist. Charging/stay-awake is not proof of idle delivery reliability. No sound tests were requested.

## Card reply, gestures and shadow (2026-11-09)

The compact card no longer has Dismiss or Snooze buttons; the gestures cover them. Swipe left snoozes (5, 10, then until back), swipe right reveals a reply field under the card. Letting go past a quarter of the width focuses the field and opens the keyboard; Send records the reply without opening Puck. The reply is written natively first (`pendingOverlayReplies`, SharedPreferences) and then sent through the answer queue (`src/cardReply.ts`); a send that fails or waits for sign-in stays queued, and only the offline screen flushes the queue today, so a queued card reply may wait until that screen runs. Swipe down turns the sheet white by 20% of the way to the bottom of the screen, carries shape and centre the whole way, and finishes by itself once past 40%. The snooze panel is one flat bot colour. The window now reserves room for the shadow so it is no longer clipped. Not compiled or run on the phone (native build pending the owner's go-ahead).

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
