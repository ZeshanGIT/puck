/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as answers from "../answers.js";
import type * as bots from "../bots.js";
import type * as clients from "../clients.js";
import type * as delivery from "../delivery.js";
import type * as device from "../device.js";
import type * as http from "../http.js";
import type * as lib_alertFields from "../lib/alertFields.js";
import type * as lib_builtInBot from "../lib/builtInBot.js";
import type * as lib_clientAuth from "../lib/clientAuth.js";
import type * as lib_clientRules from "../lib/clientRules.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_deviceAuth from "../lib/deviceAuth.js";
import type * as lib_fcm from "../lib/fcm.js";
import type * as lib_pushTargets from "../lib/pushTargets.js";
import type * as push from "../push.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  answers: typeof answers;
  bots: typeof bots;
  clients: typeof clients;
  delivery: typeof delivery;
  device: typeof device;
  http: typeof http;
  "lib/alertFields": typeof lib_alertFields;
  "lib/builtInBot": typeof lib_builtInBot;
  "lib/clientAuth": typeof lib_clientAuth;
  "lib/clientRules": typeof lib_clientRules;
  "lib/crypto": typeof lib_crypto;
  "lib/deviceAuth": typeof lib_deviceAuth;
  "lib/fcm": typeof lib_fcm;
  "lib/pushTargets": typeof lib_pushTargets;
  push: typeof push;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
