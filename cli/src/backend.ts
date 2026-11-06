import { ConvexHttpClient } from "convex/browser";
import { anyApi, type FunctionReference } from "convex/server";
import type { PairingInput } from "@puck/shared";
import { isQuestionId } from "@puck/shared";
import { CliError, publicError, redact } from "./errors";

export interface PairingResult {
  botId: string;
  secret: string;
  pairingCode: string;
}

export interface AlertBody {
  question: string;
  priority: "normal" | "urgent";
  selectionMode: "single" | "multi";
  presentation: "choice" | "swipe";
  options: { id: string; label: string; icon?: string }[];
  scheduledFor?: number;
}

export interface ListedAlert {
  questionId: string;
  question: string;
  status: "scheduled" | "pending" | "answered" | "cancelled";
  priority: "normal" | "urgent";
  scheduledFor: number | null;
  createdAt: number;
}

export interface Backend {
  createPairing(deploymentUrl: string, input: PairingInput): Promise<PairingResult>;
  postAlert(siteUrl: string, botId: string, secret: string, body: AlertBody): Promise<{ questionId: string }>;
  listAlerts(siteUrl: string, botId: string, secret: string): Promise<ListedAlert[]>;
  cancelAlert(siteUrl: string, botId: string, secret: string, questionId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const liveBackend: Backend = {
  async createPairing(deploymentUrl, input) {
    const client = new ConvexHttpClient(deploymentUrl);
    const createPairing = anyApi.bots?.createPairing as FunctionReference<"mutation"> | undefined;
    if (!createPairing) throw new CliError("pairing client is unavailable");
    let result: unknown;
    try {
      result = await client.mutation(createPairing, {
        name: input.name,
        webhookUrl: input.webhookUrl,
        webhookHeader: input.webhookHeader,
        ...(input.routine ? { routine: input.routine } : {}),
      });
    } catch (error) {
      throw new CliError(redact(publicError(error), [input.webhookHeader, input.webhookUrl]));
    }
    if (
      !isRecord(result) ||
      typeof result.botId !== "string" ||
      typeof result.secret !== "string" ||
      typeof result.pairingCode !== "string"
    ) {
      throw new CliError("pairing did not return a bot id and code");
    }
    return { botId: result.botId, secret: result.secret, pairingCode: result.pairingCode };
  },

  async postAlert(siteUrl, botId, secret, body) {
    let response: Response;
    try {
      response = await fetch(`${siteUrl}/alerts`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-puck-bot-id": botId,
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new CliError("could not reach the deployment");
    }
    const text = await response.text();
    if (!response.ok) {
      throw new CliError(redact(`alert was not accepted (${response.status})`, [secret]));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new CliError("alert response was not JSON");
    }
    if (!isRecord(parsed) || typeof parsed.questionId !== "string" || !isQuestionId(parsed.questionId)) {
      throw new CliError("alert response did not include a question id");
    }
    return { questionId: parsed.questionId };
  },

  async listAlerts(siteUrl, botId, secret) {
    const parsed = await botRequest(siteUrl, "/alerts", "GET", botId, secret);
    if (!Array.isArray(parsed)) throw new CliError("alert list was not a list");
    return parsed.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.questionId !== "string" ||
        typeof item.question !== "string" ||
        (item.status !== "scheduled" && item.status !== "pending" && item.status !== "answered" && item.status !== "cancelled") ||
        (item.priority !== "normal" && item.priority !== "urgent") ||
        (item.scheduledFor !== null && typeof item.scheduledFor !== "number") ||
        typeof item.createdAt !== "number"
      ) {
        throw new CliError("alert list was not a list");
      }
      return {
        questionId: item.questionId,
        question: item.question,
        status: item.status,
        priority: item.priority,
        scheduledFor: item.scheduledFor,
        createdAt: item.createdAt,
      };
    });
  },

  async cancelAlert(siteUrl, botId, secret, questionId) {
    await botRequest(siteUrl, `/alerts/${questionId}/cancel`, "POST", botId, secret);
  },
};

async function botRequest(siteUrl: string, path: string, method: "GET" | "POST", botId: string, secret: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${siteUrl}${path}`, {
      method,
      headers: {
        "x-puck-bot-id": botId,
        authorization: `Bearer ${secret}`,
      },
    });
  } catch {
    throw new CliError("could not reach the deployment");
  }
  const text = await response.text();
  if (!response.ok) {
    let message = `alert was not accepted (${response.status})`;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (isRecord(parsed) && typeof parsed.error === "string") message = parsed.error;
    } catch {
      // The status is enough when the body is not JSON.
    }
    throw new CliError(redact(message, [secret]));
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError("alert response was not JSON");
  }
}
