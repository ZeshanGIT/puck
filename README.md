# Puck

Puck is a pager for AI agents: an agent sends an alert, your phone rings with a full-screen, call-style notification, and your reply goes back to the agent.

## Layout

A TypeScript monorepo managed with [Bun workspaces](https://bun.sh/docs/install/workspaces):

- `app/` (`@puck/app`) - mobile app in React Native with Expo (Android first)
- `backend/` (`@puck/backend`) - Convex backend: database and HTTP endpoints; Firebase Cloud Messaging is used only for push
- `cli/` (`@puck/cli`) - `puck` CLI in TypeScript (Commander, compiled to a single executable with `bun build --compile`)
- `packages/shared/` (`@puck/shared`) - alert and reply types shared by the app, backend and CLI
- `tsconfig.base.json` - shared compiler options for `cli/` and `packages/shared/` (the app uses Expo's base config, the backend Convex's)

## Requirements

- [Bun](https://bun.sh) 1.4 or newer: `curl -fsSL https://bun.sh/install | bash`
- Node.js 22.13 or newer (LTS), needed by the Expo CLI
- For the app on Android: a development build (not Expo Go), the Android SDK, and JDK 17 for local Gradle builds

## Setup

```sh
bun install          # from the repo root; installs every workspace. Needs Bun 1.4 or newer (the lockfile version).
bun run typecheck    # typechecks all workspaces
bun test             # unit tests for hashing, validation and the answer payload
```

## App (`app/`)

The app needs a **development build** (not Expo Go) because full-screen alerts will use native modules such as Notifee later. Phase 1 adds `expo-dev-client` and the Android application id `in.puckit.app`.

### Requirements on your machine

- Node.js 22.13 or newer (LTS)
- Android SDK at `$HOME/Library/Android/sdk` (Android Studio)
- JDK 17 for Gradle (the app `start` script exports `JAVA_HOME` from `/usr/libexec/java_home -v 17`; it does not change your system Java default)

### Local Android build (no device required)

From the repo root:

```sh
~/.bun/bin/bun install
cd app
~/.bun/bin/bunx expo prebuild --platform android --no-install
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd android
./gradlew :app:assembleDebug
```

Prebuild writes `app/android/` locally (gitignored). A successful `assembleDebug` produces a debug APK under `app/android/app/build/outputs/apk/debug/`.

### Run on a device or emulator (development build)

When you have a connected device or a working emulator:

```sh
cd app
~/.bun/bin/bun run android
```

The `start` and `android` scripts export `JAVA_HOME` and `ANDROID_HOME` before calling Expo. With the dev client installed, `~/.bun/bin/bun run start` runs Metro for JavaScript hot reload.

Add native-compatible packages with `bunx expo install <package>` so versions match the Expo SDK. Metro resolves workspace packages such as `@puck/shared` automatically; no custom Metro config is needed.

## Backend (`backend/`)

The Convex project stores bots, alerts and answers (`convex/schema.ts`) and serves `GET /health`, `POST /alerts` and `GET /alerts/<questionId>`. The dev deployment is `usable-mule-44` (team `sthx-sthx`, project `puck`): the client URL is `https://usable-mule-44.convex.cloud` and HTTP actions are at `https://usable-mule-44.convex.site`. `convex/http.ts` uses the generated `httpAction`, and internal calls use `internal` from `convex/_generated/api`.

`POST /alerts` and `GET /alerts/<questionId>` authenticate with the headers `X-Puck-Bot-Id` (the public id, such as `sheldon-23648`) and `Authorization: Bearer <secret>`. The secret is hashed and compared with `bots.secretHash`. A paired bot's `POST /alerts` returns `{ "questionId": "q_..." }` immediately. The body is a question, `priority` (`normal` or `urgent`), `selectionMode` (`single` or `multi`) and `options` (`id`, `label`, optional `icon`).

Recording a reply is the public mutation `answers.record`. It stores the answer and schedules an action that POSTs the answer payload to that bot's webhook, with the stored Authorization header, retrying up to four times (immediately, then after 1s, 4s and 16s).

Pairing is stubbed as the mutations `bots.createPairing` and `bots.approvePairing`. `createPairing` returns the bot id, the secret (once) and a six-digit code. It stores a hash of the secret and an encrypted webhook header. The CLI and app do not call these yet.

`PUCK_ENCRYPTION_KEY` is set on the dev deployment. It is 32 bytes of base64. Do not print it or commit it. `backend/.env.local` is git-ignored.

Push function changes with:

```sh
cd backend
bunx convex dev --once
```

Check the health route:

```sh
curl https://usable-mule-44.convex.site/health
```

## CLI (`cli/`)

```sh
cd cli
bun run dev --help       # run from source
bun run build            # compile to cli/bin/puck (git-ignored)
./bin/puck --version
```

Commands (`send`, `ask`, `schedule`, `list`, `cancel`) are stubs that print "not implemented yet". The answer is not posted to a URL passed on the command line; Convex posts it to the webhook registered for that bot. Until the CLI calls the API, test the HTTP routes with `curl`.
