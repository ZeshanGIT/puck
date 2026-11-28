# Multi-user gap

Status: design note, not started (2026-11-28). The backend was built for one person. Two Google accounts on one Convex deployment would see, and could answer, each other's alerts. Until this is fixed, each deployment has exactly one user: the owner on dev, and one tester on prod.

## What leaks today
Findings from a code read, not from a live test.

- **Push fan-out:** `alerts.loadForPush` sends every alert to every client and to the legacy device (`alerts.ts`, the "single-user for now" comment). `alerts.loadDismissTargets` does the same for dismiss pushes.
- **Reads:** `lib/pushTargets.alertIsForClient` treats an untargeted alert as "for everyone", so `alerts.pending`, `waiting`, `history` and `get` return other users' alerts. `alerts.state` and `answers.receipt` check no ownership at all.
- **Writes:** `answers.record` and `answers.snooze` check only that the caller is a client, so user B can answer or snooze A's alert, and the answer goes to A's bot webhook.
- **Pairing:** signed-in approval is owner-checked (`lib/pairingRules.ts`). Two legacy paths are not: the device path in `bots.approvePairing`, and "adopt paired" (a bot with no `userId` can be claimed by anyone who has its code, and that code is never cleared).
- **Global limits:** the cap of five pending pairings applies to the whole deployment, counts expired rows, and nothing ever cleans them up. That means abandoned requests can lock everyone out of pairing. Queries also run fixed `take(N)` windows over all users' rows before they filter, so one busy user can crowd another out.

## Fix (option B)
1. **Owner on every alert:** store `userId` on alerts when they are created, from the bot's owner. Backfill existing rows through a migration (see the release plan's widen, migrate, narrow steps).
2. **Scope every query by user:** `pending`, `waiting`, `history`, `get`, `state` and `receipt` filter on the caller's `userId`, with a `by_user_status` index in place of the global `take` windows.
3. **Scope pushes:** `loadForPush` and `loadDismissTargets` send only to the owner's clients, through `selectPushTargets`.
4. **Owner checks on writes:** `answers.record` and `snooze` reject an alert whose owner is not the caller.
5. **Retire the legacy paths:** the device approval path and adopt-paired, or require a `userId` match.
6. **Pairing cap:** expire pending pairings, either with a cron or by ignoring expired rows in the count, and make the cap per user, or per caller IP for the unauthenticated `createPairing`.
7. **Tests:** two-user cases for each item above. Then a live check on dev with two Google accounts.

Files: `backend/convex/alerts.ts`, `answers.ts`, `bots.ts`, `schema.ts`, `lib/pushTargets.ts`, `lib/pairingRules.ts`, `packages/shared/src/model.ts`, plus a migration. The app and CLI should need no changes beyond tests. Rough size: half a day plus review.
