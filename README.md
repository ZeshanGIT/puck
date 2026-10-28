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
bun install          # from the repo root; installs every workspace
bun run typecheck    # typechecks all workspaces
```

## App (`app/`)

```sh
cd app
bun run start        # Expo dev server (scan the QR code with Expo Go for now)
bun run android      # start and open on a connected Android device or emulator
```

Add native-compatible packages with `bunx expo install <package>` so versions match the Expo SDK. Metro resolves workspace packages such as `@puck/shared` automatically; no custom Metro config is needed.

## Backend (`backend/`)

The Convex project is scaffolded (`convex/schema.ts`, `convex/http.ts` with a `GET /health` route) but not yet connected to a deployment.

First-time connection (needs the Convex account that will own the project):

```sh
cd backend
bun run dev          # convex dev: log in, create or pick the project, then watch and push
```

This writes `backend/.env.local` (git-ignored) and generates `backend/convex/_generated/`, which should be committed. After that, switch `convex/http.ts` from `httpActionGeneric` to the typed `httpAction` from `./_generated/server`. Until a deployment exists, `convex codegen` cannot run, so the code only uses the generic helpers from `convex/server` and still typechecks.

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

Commands (`send`, `ask`, `schedule`, `list`, `cancel`) are stubs that print "not implemented yet" until the backend endpoints exist. Until then, test endpoints with `curl`.
