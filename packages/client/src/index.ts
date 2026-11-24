import { api } from "../../../backend/convex/_generated/api.js";
import type { FunctionArgs, FunctionReturnType } from "convex/server";

/** Public client operations. Use these with Convex hooks or an authenticated Convex client. */
export const clientApi = {
  clients: {
    list: api.clients.list,
    register: api.clients.register,
    touch: api.clients.touch,
    rename: api.clients.rename,
    remove: api.clients.remove,
    setFlags: api.clients.setFlags,
    setPushToken: api.clients.setPushToken,
  },
  bots: {
    list: api.bots.list,
  },
  alerts: {
    pending: api.alerts.pending,
    get: api.alerts.get,
    state: api.alerts.state,
    waiting: api.alerts.waiting,
    wakeSnoozed: api.alerts.wakeSnoozed,
  },
  answers: {
    record: api.answers.record,
    snooze: api.answers.snooze,
    receipt: api.answers.receipt,
    retryDelivery: api.answers.retryDelivery,
  },
} as const;

export type ClientRegistration = FunctionArgs<typeof clientApi.clients.register>;
export type ClientPlatform = ClientRegistration["platform"];
export type ClientRegistrationResult = FunctionReturnType<typeof clientApi.clients.register>;
export type ClientCatalogItem = FunctionReturnType<typeof clientApi.clients.list>[number];
export type BotCatalogItem = FunctionReturnType<typeof clientApi.bots.list>[number];
export type PendingAlert = FunctionReturnType<typeof clientApi.alerts.pending>[number];
export type AlertDetail = NonNullable<FunctionReturnType<typeof clientApi.alerts.get>>;
export type RecordAnswerArgs = FunctionArgs<typeof clientApi.answers.record>;
export type RecordAnswerResult = FunctionReturnType<typeof clientApi.answers.record>;
export type RetryDeliveryArgs = FunctionArgs<typeof clientApi.answers.retryDelivery>;
export type SnoozeAlertArgs = FunctionArgs<typeof clientApi.answers.snooze>;
export type SnoozeAlertResult = FunctionReturnType<typeof clientApi.answers.snooze>;

export { orderStack } from "./order";
export { answerFor, isNotice, NOTICE_OPTION_ID, NOTICE_REPLY } from "./notice";
export {
  CLIENT_NAME_MAX,
  ensureClientRegistered,
  registerAnotherName,
  replaceClient,
  type RegistrationDeps,
  type RegistrationOutcome,
} from "./registration";
