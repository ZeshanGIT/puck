This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Not set up yet: this is the blank TypeScript template (`App.tsx` + `index.ts`), with no Expo Router. When screens are added, use **Expo Router** with routes in `src/app/` (every file there is a screen, `_layout.tsx` files define navigators) and keep non-route code outside `src/app/`.
- Docs: https://docs.expo.dev/router/introduction.md

## Puck monorepo

- This app is the `@puck/app` workspace in a Bun-workspaces monorepo; run `bun install` from the repo root, not here.
- Shared alert/reply types come from `@puck/shared` (`packages/shared`). Metro resolves workspace packages automatically (SDK 52+); do not add `watchFolders` or `nodeModulesPaths` to a Metro config.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## State machines

- A flow with two or more flags that must agree (a lifecycle, a multi-step screen, a permission check) is a machine: one pure `transition(state, event)` in a `*Machine.ts` file, built with `defineMachine` from `@puck/shared`. No React and no I/O inside; effects come back as data.
- Read `docs/state-machines.md` (the map and the convention) before changing a flow. Register a new machine in `app/src/machines.ts`; `bun test` fails if you forget. Run `bun run machines:doc` after changing a machine so the diagrams stay current (`bun run machines:check` verifies).
- Backend alert status changes go through `decideAlert` (`packages/shared/src/alertLifecycle.ts`), never an ad hoc patch.

