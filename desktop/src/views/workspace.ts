import type { DesktopState } from "../protocol";
import type { WorkspacePage } from "../workspaceProtocol";
import { renderArchive, renderHomeActivity } from "./activity";
import { button, element, navigationIcon, notice } from "./elements";
import { renderBots, renderSettings } from "./management";
import type { WorkspaceActions } from "./workspaceActions";

export function renderWorkspace(page: WorkspacePage, state: DesktopState, actions: WorkspaceActions) {
  switch (page) {
    case "home": {
      const home = renderHomeActivity(state, actions);
      if (state.connection === "offline") {
        home.prepend(notice(state.error ?? "Puck is offline. Updates resume when it reconnects.", true));
      }
      return home;
    }
    case "bots": return renderBots(state, actions);
    case "archive": return renderArchive(state, actions);
    case "settings": return renderSettings(state, actions);
  }
}

export function workspaceNavigation(page: WorkspacePage, navigate: WorkspaceActions["navigate"]) {
  const nav = element("nav", "workspace-nav");
  nav.setAttribute("aria-label", "Puck");
  for (const [id, label] of workspacePages) {
    const item = button(label, () => navigate(id), "workspace-link");
    item.prepend(navigationIcon(id));
    item.id = `nav-${id}`;
    if (id === page) item.setAttribute("aria-current", "page");
    nav.append(item);
  }
  return nav;
}

const workspacePages = [
  ["home", "Home"], ["bots", "Bots"], ["archive", "Archive"], ["settings", "Settings"],
] as const;
