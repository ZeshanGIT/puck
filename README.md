# Puck

Puck is a pager for AI agents: an agent sends an alert, your phone rings with a full-screen, call-style notification, and your reply goes back to the agent.

## Planned layout

A TypeScript monorepo (workspace tooling chosen at scaffold time):

- `app/` - mobile app in React Native with Expo (Android first)
- `backend/` - Convex backend: database and HTTP endpoints; Firebase Cloud Messaging is used only for push
- `cli/` - `puck` CLI in TypeScript (Commander, compiled to a single executable)
