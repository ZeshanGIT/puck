import type { ConvexClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { clientApi } from "@puck/client";
import type { DesktopResult } from "../protocol";
import type { HistoryItem, WorkspaceCommand, WorkspaceState } from "../workspaceProtocol";

const PAGE_SIZE = 30;
const ok = { ok: true } as const;
type Query = FunctionReference<"query">;

// The simple client's preview API owns paginationOpts itself, although its
// current generic signature does not omit that argument.
const paginatedHistory = clientApi.alerts.history as unknown as FunctionReference<
  "query", "public", { clientId: string }, HistoryItem
>;
type Resources = "bots" | "pairing" | "clients" | "waiting" | "live" | "archivedTasks" | "detail";

type Effects = {
  openLink(url: string | undefined): DesktopResult;
  showTest(questionId: string): void;
};

export class DesktopWorkspace {
  private state: WorkspaceState;
  private detailSubscription?: () => void;
  private loadMore?: (count: number) => boolean;

  constructor(
    private readonly client: ConvexClient,
    private readonly clientId: string,
    private readonly publish: (state: WorkspaceState) => void,
    private readonly effects: Effects,
  ) {
    this.state = { clientId, errors: {} };
  }

  start(): void {
    const args = { clientId: this.clientId };
    this.publish(this.state);
    this.subscribe("bots", clientApi.bots.list, args, (data) => data);
    this.subscribe("pairing", clientApi.bots.pairingRequests, args, (data) => data);
    this.subscribe("clients", clientApi.clients.list, {}, (data) => data);
    this.subscribe("waiting", clientApi.alerts.waiting, args, (data) => data);
    this.subscribe("live", clientApi.live.forUser, args, (data) => data);
    this.subscribe("archivedTasks", clientApi.live.archive, args, (data) => data);
    this.client.onPaginatedUpdate_experimental(paginatedHistory, args, { initialNumItems: PAGE_SIZE }, (result) => {
      // Convex 1.48 declares a normal query page in this callback. The browser client emits
      // the aggregate results, status and loadMore callback from its paginated client.
      const page = result as unknown as {
        results: HistoryItem[];
        status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
        loadMore: (count: number) => boolean;
      };
      if (page.status === "LoadingFirstPage") return;
      this.loadMore = page.loadMore;
      this.update({ history: { items: page.results, hasMore: page.status !== "Exhausted" } }, "history");
    }, () => this.report("history"));
  }

  private update(patch: Partial<WorkspaceState>, key?: keyof WorkspaceState["errors"]): void {
    const errors = { ...this.state.errors };
    if (key) delete errors[key];
    this.state = { ...this.state, ...patch, errors };
    this.publish(this.state);
  }

  private report(key: keyof WorkspaceState["errors"]): void {
    this.state = { ...this.state, errors: { ...this.state.errors, [key]: "Puck couldn’t load this section." } };
    this.publish(this.state);
  }

  private subscribe<K extends Resources, Q extends Query>(
    key: K,
    query: Q,
    args: FunctionArgs<Q>,
    transform: (data: FunctionReturnType<Q>) => WorkspaceState[K],
  ): () => void {
    return this.client.onUpdate(query, args, (data) => this.update({ [key]: transform(data) }, key),
      () => this.report(key));
  }

  async run(command: WorkspaceCommand): Promise<DesktopResult> {
    const clientId = this.clientId;
    const invalid = (error: string): DesktopResult => ({ ok: false, error });
    try {
      switch (command.type) {
        case "loadHistory":
          this.loadMore?.(PAGE_SIZE);
          break;
        case "loadDetail": {
          this.detailSubscription?.();
          this.update({ detail: undefined }, "detail");
          const { questionId } = command;
          this.detailSubscription = this.subscribe("detail", clientApi.alerts.get, { clientId, questionId },
            (alert) => ({ questionId, alert }));
          break;
        }
        case "openDetailLink":
          return this.effects.openLink(this.state.detail?.questionId === command.questionId
            ? this.state.detail.alert?.link?.url : undefined);
        case "openTaskLink":
          return this.effects.openLink(this.state.live?.find(({ activityId }) => activityId === command.activityId)?.link?.url);
        case "wake":
          await this.client.mutation(clientApi.alerts.wakeSnoozed, { clientId });
          break;
        case "retryDelivery": {
          const answer = this.state.detail?.alert?.answer;
          if (answer?.answerId !== command.answerId) return invalid("Open the alert to retry delivery.");
          const answerId = answer.answerId as FunctionArgs<typeof clientApi.answers.retryDelivery>["answerId"];
          await this.client.mutation(clientApi.answers.retryDelivery, { clientId, answerId });
          break;
        }
        case "pair":
          if (!/^\d{6}$/.test(command.pairingCode)) return invalid("Enter the six-digit pairing code.");
          await this.client.mutation(clientApi.bots.approvePairing, { clientId, pairingCode: command.pairingCode });
          break;
        case "rejectPairing":
          await this.client.mutation(clientApi.bots.rejectPairing, { clientId, botId: command.botId });
          break;
        case "updateBot": {
          const { type: _, ...change } = command;
          await this.client.mutation(clientApi.bots.update, { clientId, ...change });
          break;
        }
        case "removeBot":
          await this.client.mutation(clientApi.bots.remove, { clientId, botId: command.botId });
          break;
        case "renameClient":
          await this.client.mutation(clientApi.clients.rename, { clientId: command.clientId, name: command.name });
          break;
        case "removeClient":
          if (command.clientId === clientId) return invalid("Sign out to remove this Mac.");
          await this.client.mutation(clientApi.clients.remove, { clientId: command.clientId });
          break;
        case "sendTest": {
          const { questionId } = await this.client.mutation(clientApi.alerts.sendTest, { clientId });
          this.effects.showTest(questionId);
          break;
        }
        default:
          return invalid("Unsupported Puck action.");
      }
      return ok;
    } catch {
      if (command.type === "pair") return invalid("Pairing failed. Check the code and try again.");
      if (command.type === "renameClient") return invalid("Couldn’t rename that device. Choose a unique name.");
      return invalid("Puck couldn’t complete that action. Try again.");
    }
  }
}
