import { makeFunctionReference } from "convex/server";

// Function references without convex/_generated. `convex dev` has not been
// run, so there is no generated `api` or `internal` module. These names match
// the file and export (`alerts:create` is `create` in `alerts.ts`). After
// codegen, `internal.alerts.create` is the same reference and can replace them.
// makeFunctionReference types the visibility as public; the functions themselves
// are internal except createPairing, approvePairing and recordAnswer.

export const authenticateBot = makeFunctionReference<
  "query",
  { botId: string; secretHash: string },
  { ok: false; reason: "unauthorized" | "not_paired" } | { ok: true; botDocId: string }
>("bots:authenticate");

export const createAlert = makeFunctionReference<
  "mutation",
  {
    botDocId: string;
    question: string;
    priority: "normal" | "urgent";
    selectionMode: "single" | "multi";
    options: { id: string; label: string; icon?: string }[];
    scheduledFor: number | null;
  },
  { questionId: string }
>("alerts:create");

export const getAlertStatus = makeFunctionReference<
  "query",
  { botDocId: string; questionId: string },
  Record<string, unknown> | null
>("alerts:getStatus");

export const beginDelivery = makeFunctionReference<
  "mutation",
  { answerId: string },
  | { proceed: false }
  | { proceed: true; webhookUrl: string; webhookHeader: string; body: string }
>("delivery:begin");

export const completeDelivery = makeFunctionReference<"mutation", { answerId: string }, null>(
  "delivery:complete",
);

export const failDelivery = makeFunctionReference<
  "mutation",
  { answerId: string; error: string; retry: boolean },
  null
>("delivery:fail");

export const deliverAnswer = makeFunctionReference<"action", { answerId: string }, null>(
  "delivery:deliver",
);
