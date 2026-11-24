import { hostname } from "node:os";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import {
  clientApi,
  ensureClientRegistered,
  registerAnotherName,
  type BotCatalogItem,
  type RegistrationDeps,
} from "@puck/client";
import { BOT_COLOURS, BOT_SHAPES, ClerkTokenError, endClerkSession, fetchConvexToken } from "@puck/shared";
import type { DesktopAlert, DesktopState } from "../protocol";
import { convexUrl, frontendApi, keychain, timedFetch } from "./auth";
import type { DesktopAccount } from "./keychain";

type InboxEvents = {
  alerts: (alerts: DesktopAlert[], mayNotify: boolean) => void;
  connection: (connection: DesktopState["connection"], error?: string) => void;
  expired: () => void;
};

export class DesktopInbox {
  readonly client = new ConvexClient(convexUrl, { logger: false });
  private retryTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(readonly account: DesktopAccount, private readonly events: InboxEvents) {}

  start(delayMs = 1_000): void {
    void this.connect().catch((error: unknown) => {
      if (this.closed) return;
      if (error instanceof ClerkTokenError && error.code === "signed-out") {
        this.events.expired();
        return;
      }
      this.events.connection("offline", "Could not connect to the Puck inbox. Retrying…");
      this.retryTimer = setTimeout(() => this.start(Math.min(delayMs * 2, 30_000)), delayMs);
    });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    void this.client.close();
  }

  async endSession(): Promise<void> {
    try {
      if (this.account.clientId) {
        const http = await this.httpClient();
        await http.mutation(clientApi.clients.remove, { clientId: this.account.clientId });
      }
    } catch {
      // Local sign-out can finish even if the server is unavailable.
    } finally {
      await endClerkSession({ frontendApi, account: this.account, fetchImpl: timedFetch });
    }
  }

  private async httpClient(): Promise<ConvexHttpClient> {
    const auth = await fetchConvexToken({ frontendApi, account: this.account, fetchImpl: timedFetch });
    return new ConvexHttpClient(convexUrl, { auth, fetch: timedFetch, logger: false });
  }

  private async connect(): Promise<void> {
    const http = await this.httpClient();
    if (this.closed) return;

    const deps: RegistrationDeps = {
      platform: "macos",
      readClientId: async () => this.account.clientId ?? null,
      saveClientId: async (clientId) => this.saveClientId(clientId),
      clearClientId: async () => this.saveClientId(undefined),
      listClients: async () => (await http.query(clientApi.clients.list, {})).filter((client) => client.platform === "macos"),
      register: async (args) => {
        if (this.closed) throw new Error("Session ended");
        const result = await http.mutation(clientApi.clients.register, args);
        if (this.closed && result.status === "created") {
          await http.mutation(clientApi.clients.remove, { clientId: result.clientId });
        }
        return result;
      },
      touch: (clientId) => http.mutation(clientApi.clients.touch, { clientId }),
    };
    const machine = hostname().split(".")[0]?.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "").trim();
    const name = [...(machine ? `Mac · ${machine}` : "Mac")].slice(0, 40).join("").trimEnd();
    const initial = await ensureClientRegistered(deps, name);
    const registration = initial.kind === "ready" ? initial : await registerAnotherName(deps, initial.name);
    if (this.closed || registration.kind !== "ready") return;
    keychain.write(this.account);

    let snapshotConnection: number | undefined;
    const refresh = async () => {
      try {
        return await fetchConvexToken({ frontendApi, account: this.account, fetchImpl: timedFetch });
      } catch (error) {
        if (this.closed) return null;
        if (error instanceof ClerkTokenError && error.code === "signed-out") {
          // Close after the Convex auth callback has returned.
          queueMicrotask(() => { if (!this.closed) this.events.expired(); });
        } else {
          snapshotConnection = undefined;
          this.events.connection("offline", "Could not refresh Puck sign-in.");
          this.retryTimer = setTimeout(() => {
            if (!this.closed) this.client.setAuth(refresh);
          }, 5_000);
        }
        return null;
      }
    };
    this.client.setAuth(refresh);

    const args = { clientId: registration.clientId };
    let bots = new Map<string, BotCatalogItem>();
    let pending: DesktopAlert[] | undefined;
    const emitAlerts = (mayNotify: boolean) => {
      if (!pending || this.closed) return;
      this.events.alerts(pending.map((alert) => {
        const bot = bots.get(alert.botId);
        return {
          ...alert,
          botColour: BOT_COLOURS.find((colour) => colour === bot?.colour),
          botShape: BOT_SHAPES.find((shape) => shape === bot?.shape),
          botMutedUntil: bot?.mutedUntil ?? undefined,
        };
      }), mayNotify);
    };
    this.client.onUpdate(clientApi.bots.list, args, (catalog) => {
      if (this.closed) return;
      bots = new Map(catalog.map((bot) => [bot.botId, bot]));
      emitAlerts(false);
    }, () => {
      bots.clear();
      emitAlerts(false);
    });

    this.client.subscribeToConnectionState((connection) => {
      if (this.closed) return;
      if (!connection.isWebSocketConnected) {
        this.events.connection(connection.hasEverConnected || connection.connectionRetries > 0 ? "offline" : "connecting");
      } else if (snapshotConnection === connection.connectionCount) {
        this.events.connection("online");
      } else {
        this.events.connection("connecting");
      }
    });
    this.client.onUpdate(clientApi.alerts.pending, args, (alerts) => {
      if (this.closed) return;
      const connection = this.client.connectionState();
      if (!connection.isWebSocketConnected) return;
      const mayNotify = snapshotConnection === connection.connectionCount;
      snapshotConnection = connection.connectionCount;
      pending = alerts;
      emitAlerts(mayNotify);
      this.events.connection("online");
    }, () => {
      if (this.closed) return;
      snapshotConnection = undefined;
      this.events.connection("offline", "Could not load the Puck inbox.");
    });
  }

  private saveClientId(clientId: string | undefined): void {
    if (this.closed) return;
    if (clientId === undefined) delete this.account.clientId;
    else this.account.clientId = clientId;
  }
}
