import { AlertValidationError, isBotId, isQuestionId, validateCreateAlert } from "@puck/shared";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hashSecret } from "./lib/crypto";
import { DeviceAuthError, publicJwks } from "./lib/deviceAuth";

// HTTP endpoints, served at https://<deployment>.convex.site.
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
  handler: httpAction(async () => json({ ok: true, service: "puck" }, 200)),
});

// Public key for the device JWT. Private key material never leaves the signing helper.
http.route({
  path: "/.well-known/jwks.json",
  method: "GET",
  handler: httpAction(async () => {
    try {
      return json(await publicJwks(), 200);
    } catch (error) {
      if (error instanceof DeviceAuthError) return json({ error: "jwks unavailable" }, 500);
      throw error;
    }
  }),
});

http.route({
  path: "/alerts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
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
    const created = await ctx.runMutation(internal.alerts.create, {
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
  handler: httpAction(async (ctx, request) => {
    const auth = await authenticate(ctx, request);
    if (auth instanceof Response) return auth;
    const questionId = decodeURIComponent(new URL(request.url).pathname.slice("/alerts/".length));
    if (!isQuestionId(questionId)) return json({ error: "alert not found" }, 404);
    const status = await ctx.runQuery(internal.alerts.getStatus, {
      botDocId: auth.botDocId,
      questionId,
    });
    if (status === null) return json({ error: "alert not found" }, 404);
    return json(status, 200);
  }),
});

async function authenticate(
  ctx: ActionCtx,
  request: Request,
): Promise<{ botDocId: Id<"bots"> } | Response> {
  const botId = request.headers.get("x-puck-bot-id")?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
  if (!isBotId(botId) || secret.length === 0 || secret.length > 256) {
    return json({ error: "unauthorized" }, 401);
  }
  const secretHash = await hashSecret(secret);
  const result = await ctx.runQuery(internal.bots.authenticate, { botId, secretHash });
  if (!result.ok) {
    if (result.reason === "not_paired") return json({ error: "bot is not paired" }, 403);
    return json({ error: "unauthorized" }, 401);
  }
  return { botDocId: result.botDocId };
}

export default http;
