# Puck

Puck is a pager for AI agents: an agent sends an alert, your phone rings with a full-screen, call-style notification, and your reply goes back to the agent.

## Planned layout

- `app/` - Flutter phone app (Android first)
- `backend/` - Convex backend (TypeScript): database and HTTP endpoints; Firebase Cloud Messaging is used only for push
- `cli/` - command-line client (later)

Until the CLI exists, the endpoints are tested with `curl`.
