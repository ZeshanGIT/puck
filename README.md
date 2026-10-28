# Puck

Puck is a pager for AI agents: an agent sends an alert, your phone rings with a full-screen, call-style notification, and your reply goes back to the agent.

## Planned layout

- `app/` - mobile app (Android first; framework TBD)
- `backend/` - Convex backend (TypeScript): database and HTTP endpoints; Firebase Cloud Messaging is used only for push
- `cli/` - `puck` CLI in TypeScript (Commander, compiled to a single executable)
