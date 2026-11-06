# Maestro flows (Android emulator)

Run from `puck/app` with the dev client open on Metro (port 8082):

    bun run flow smoke-home
    bun run flow dev-sample SAMPLE=home

Targets `emulator-5554` only. Prints PASS or FAIL, the log path and any screenshot path.
Maestro logs and per-run artifacts go under `.shots/maestro/` (gitignored with `.shots/`).

## Files
- `launch-app.yaml`: subflow. stopApp, opens the dev-client URL for Metro 8082, waits up to 60 s for "Puck".
- `smoke-home.yaml`: launches, asserts the real Home ("Puck" header, "Settings" icon).
- `dev-sample.yaml`: opens `puck://dev-alert?sample=${SAMPLE}`, waits for the Home header when SAMPLE=home, saves `.shots/maestro/dev-sample-<SAMPLE>.png`, checks no crash dialog, ends with stopApp.

## Writing a flow for a screen
1. Start with `- runFlow: launch-app.yaml`.
2. Navigate with `tapOn` (text, or `id:` for list rows).
3. Check with `assertVisible`.
4. Screenshot with a plain name: `takeScreenshot: my-name` (no path, no `../`). `flow.sh` copies it to `.shots/maestro/my-name.png`.
5. End any sample flow with `stopApp`, so no sample screen is left for the next run.

## Finding elements
    maestro --device emulator-5554 hierarchy 2>/dev/null > /tmp/h.json   # or the scratchpad

- Text and accessibility label: `"Bots"` matches either the visible text or the label (regex, whole text).
- testID: `id: "pair-bot"` (regex allowed, e.g. `id: "bot-row-.*"`). React Native testIDs show as Android resource-ids.
- testID convention: `<screen>-<thing>` in kebab case, for example `pair-bot`, `bot-row-<name>`, `mute-<id>`, `sound-urgent`, `a5-send`.
- Home (H1) sets no testIDs of its own; use its text. Prefer testIDs on new list rows and buttons whose text can change.

## Quirks
- Do not put defaults in a flow's `env:` header: the header wins over `-e KEY=VALUE`, so the value passed is ignored.
- Armed buttons (Approve and Remove) need both taps in one `doubleTapOn`; separate `tapOn` calls miss the arm window.
- B2 and B4 controls sit below the fold: `scrollUntilVisible` them before tapping.
- The shell may export an older `JAVA_HOME` (here Java 11); Maestro 2 needs 17. `flow.sh` selects `java_home -v 17`.
- `takeScreenshot` names are confined to the run's output folder, so `../` paths fail.
- A dev sample shows the dev-client splash for a moment after the link; wait for a header before the screenshot.
- The Maestro analytics notice goes to stdout; `flow.sh` disables it. macOS has no `timeout` command.
