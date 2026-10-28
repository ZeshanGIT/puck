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
- For the app on a phone: Android device or emulator; full-screen alerts will need a development build (not Expo Go)

## Setup

```sh
bun install          # from the repo root; installs every workspace. Needs Bun 1.4 or newer (the lockfile version).
bun run typecheck    # typechecks all workspaces
bun test             # unit tests for hashing, validation and the answer payload
```

## App (`app/`)

```sh
cd app
bun run start        # Expo dev server (scan the QR code with Expo Go for now)
bun run android      # start and open on a connected Android device or emulator
```

Add native-compatible packages with `bunx expo install <package>` so versions match the Expo SDK. Metro resolves workspace packages such as `@puck/shared` automatically; no custom Metro config is needed.

## Backend (`backend/`)

The Convex project stores bots, alerts and answers (`convex/schema.ts`) and serves `GET /health`, `POST /alerts` and `GET /alerts/<questionId>`. It is not connected to a deployment yet, so `convex/_generated/` does not exist. HTTP actions use `httpActionGeneric`, and cross-function calls use `makeFunctionReference` until the first `bun run dev`.

`POST /alerts` and `GET /alerts/<questionId>` authenticate with the headers `X-Puck-Bot-Id` (the public id, such as `sheldon-23648`) and `Authorization: Bearer <secret>`. The secret is hashed and compared with `bots.secretHash`. A paired bot's `POST /alerts` returns `{ "questionId": "q_..." }` immediately. The body is a question, `priority` (`normal` or `urgent`), `selectionMode` (`single` or `multi`) and `options` (`id`, `label`, optional `icon`).

Recording a reply is the public mutation `answers.record`. It stores the answer and schedules an action that POSTs the answer payload to that bot's webhook, with the stored Authorization header, retrying up to four times (immediately, then after 1s, 4s and 16s).

Pairing is stubbed as the mutations `bots.createPairing` and `bots.approvePairing`. `createPairing` returns the bot id, the secret (once) and a six-digit code. It stores a hash of the secret and an encrypted webhook header. The CLI and app do not call these yet.

Set the encryption key in the Convex deployment environment before pairing or delivery. It must be 32 bytes, base64-encoded. Do not commit it.

```sh
cd backend
bunx convex env set PUCK_ENCRYPTION_KEY "$(openssl rand -base64 32)"
```

First-time connection (needs the Convex account that will own the project):

```sh
cd backend
bun run dev          # convex dev: log in, create or pick the project, then watch and push
```

This writes `backend/.env.local` (git-ignored) and generates `backend/convex/_generated/`, which should be committed. After that, switch `convex/http.ts` from `httpActionGeneric` to the typed `httpAction` from `./_generated/server`, and switch `convex/refs.ts` from `makeFunctionReference` to `internal` from `./_generated/api`. Until a deployment exists, `convex codegen` cannot run, so the code only uses the generic helpers from `convex/server` and still typechecks. No generated files are committed in their place.

Check the health route:

```sh
curl https://<deployment>.convex.site/health
```

## CLI (`cli/`)

```sh
cd cli
bun run dev --help       # run from source
bun run build            # compile to cli/bin/puck (git-ignored)
./bin/puck --version
```

Commands (`send`, `ask`, `schedule`, `list`, `cancel`) are stubs that print "not implemented yet". The answer is not posted to a URL passed on the command line; Convex posts it to the webhook registered for that bot. Until the CLI calls the API, test the HTTP routes with `curl`.
