# Phone testing CLI

Run `python3 app/scripts/phone.py --help` from the repository root. The CLI uses ADB from `ANDROID_HOME/platform-tools` or PATH. It accepts `--serial` before the command, then `PUCK_ADB_SERIAL` or `ANDROID_SERIAL`. Without a serial it requires exactly one authorized physical device. It checks that the selected device is a physical Pixel 7 and refuses emulators and unknown or unauthorized devices.

- `status` reports the serial and keyguard state. Unknown keyguard state is an error.
- `wake`, `lock`, and `home` send the corresponding key event. `lock` verifies keyguard state.
- `screenshot [path]` saves a verified PNG, defaulting to `app/.shots/phone.png`.
- `ui` prints compact accessibility nodes as JSON. Password node text and description are suppressed.
- `find --text 'Exact text' --timeout 10` waits up to 60 seconds. `--description` and `--resource-id` are alternatives. Matching is exact.
- `tap --text 'Exact text'` taps the center of the unique matching node. It also accepts `--description` or `--resource-id`. Missing, duplicate, or invalid bounds fail.
- `gesture x,y x,y [x,y ...]` sends one continuous touchscreen gesture through the helper. Use explicit nonsecret points for a harmless launcher gesture before a future unlock attempt.
- `unlock` makes at most one pattern attempt using the live `bouncer_pattern_root` bounds and checks the keyguard afterward. If the grid is unavailable or verification fails, it stops without retrying.

Gesture commands require JDK 17 `javac` on PATH and an Android SDK in `ANDROID_HOME`, with a platform `android.jar` and build-tools `d8`. The CLI compiles the Java helper on demand into the ignored `app/.shots/tools` cache, fingerprints the source and SDK tools, and pushes a dex jar to `/data/local/tmp`. It runs as the shell user in one `app_process`: DOWN, interpolated MOVE events, and UP share one down time. Coordinates travel over standard input. No APK or root is needed.

Store the unlock pattern in `~/.config/puck/phone-unlock` with permissions `0600`. It is a sequence of distinct digits 1 through 9, numbered left to right, top to bottom. Never put it in a command argument, repository file, or screenshot. The CLI does not take screenshots during unlock. Android may insert intermediate dots between nonadjacent points, so provide the actual complete pattern sequence.

The accessibility dump uses a temporary XML file on the device at `/sdcard/window.xml`; it may contain sensitive screen contents. Avoid running `ui`, `find`, or `tap` on sensitive screens, and remove that file when appropriate. The CLI does not change permanent Android settings.
