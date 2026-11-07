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

**Related branch:** `cursor/reply-sheet-keyboard-565d` (`a928d15`) is independent; merge separately.
