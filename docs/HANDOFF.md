# Puck product handoff (app repo)

Updated when product direction or alert presentation behavior changes. Vault `Projects/Puck/HANDOFF` remains the session log across repos.

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
