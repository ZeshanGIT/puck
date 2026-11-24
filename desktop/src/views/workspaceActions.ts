import type { DesktopResult } from "../protocol";
import type { ThemePreference, WorkspaceCommand, WorkspacePage } from "../workspaceProtocol";

export interface WorkspaceActions {
  command(command: WorkspaceCommand): Promise<DesktopResult>;
  navigate(page: WorkspacePage): void;
  openAlert(questionId: string): void;
  setThemePreference(preference: ThemePreference): Promise<DesktopResult>;
  signOut(): Promise<DesktopResult>;
  refresh(): void;
}
