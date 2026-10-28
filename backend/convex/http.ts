import { AlertValidationError, isBotId, isQuestionId, validateCreateAlert } from "@puck/shared";
import { httpActionGeneric, httpRouter } from "convex/server";
import { hashSecret } from "./lib/crypto";
import { authenticateBot, createAlert, getAlertStatus } from "./refs";

// HTTP endpoints, served at https://<deployment>.convex.site.
//
// Uses httpActionGeneric and makeFunctionReference because convex/_generated
// does not exist yet. After `bun run dev` connects a deployment, the generated
// `httpAction` and `internal` object can replace them. The routes stay the same.
//
// POST /alerts and GET /alerts/:questionId authenticate with
// `X-Puck-Bot-Id` and `Authorization: Bearer <secret>`. The secret is hashed
// and compared with bots.secretHash. It is never stored or logged.

const http = httpRouter();

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

http.route({
  path: "/health",
  method: "GET",
  handler: httpActionGeneric(async () => json({ ok: true, service: "puck" }, 200)),
});

http.route({
  path: "/alerts",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (auth instanceof Response) return auth;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    let input;
    try {
      input = validateCreateAlert(body);
    } catch (error) {
      if (error instanceof AlertValidationError) return json({ error: error.message }, 400);
      throw error;
    }
    const created = await ctx.runMutation(createAlert, {
      botDocId: auth.botDocId,
      question: input.question,
      priority: input.priority,
      selectionMode: input.selectionMode,
      options: input.options,
      scheduledFor: input.scheduledFor,
    });
    return json({ questionId: created.questionId }, 201);
  }),
});

http.route({
  pathPrefix: "/alerts/",
  method: "GET",
  handler: httpActionGeneric(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (auth instanceof Response) return auth;
    const questionId = decodeURIComponent(new URL(request.url).pathname.slice("/alerts/".length));
    if (!isQuestionId(questionId)) return json({ error: "alert not found" }, 404);
    const status = await ctx.runQuery(getAlertStatus, {
      botDocId: auth.botDocId,
      questionId,
    });
    if (status === null) return json({ error: "alert not found" }, 404);
    return json(status, 200);
  }),
});

async function authenticate(
  ctx: {
    runQuery: (
      ref: typeof authenticateBot,
      args: { botId: string; secretHash: string },
    ) => Promise<
      { ok: false; reason: "unauthorized" | "not_paired" } | { ok: true; botDocId: string }
    >;
  },
  request: Request,
): Promise<{ botDocId: string } | Response> {
  const botId = request.headers.get("x-puck-bot-id")?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
  if (!isBotId(botId) || secret.length === 0 || secret.length > 256) {
    return json({ error: "unauthorized" }, 401);
  }
  const secretHash = await hashSecret(secret);
  const result = await ctx.runQuery(authenticateBot, { botId, secretHash });
  if (!result.ok) {
    if (result.reason === "not_paired") return json({ error: "bot is not paired" }, 403);
    return json({ error: "unauthorized" }, 401);
  }
  return { botDocId: result.botDocId };
}

export default http;
