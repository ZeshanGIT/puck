// Handler-level test harness: convex-test over the real schema and functions.
// `import.meta.glob` does not exist under bun, so the module map is written out. Keys are the
// paths convex-test expects (the `_generated` directory must be among them).
import { convexTest } from "convex-test";
import schema from "../convex/schema";

export const modules: Record<string, () => Promise<unknown>> = {
  "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
  "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
  "../convex/alerts.ts": () => import("../convex/alerts"),
  "../convex/answers.ts": () => import("../convex/answers"),
  "../convex/botMessages.ts": () => import("../convex/botMessages"),
  "../convex/bots.ts": () => import("../convex/bots"),
  "../convex/clients.ts": () => import("../convex/clients"),
  "../convex/delivery.ts": () => import("../convex/delivery"),
  "../convex/device.ts": () => import("../convex/device"),
  "../convex/files.ts": () => import("../convex/files"),
  "../convex/http.ts": () => import("../convex/http"),
  "../convex/live.ts": () => import("../convex/live"),
  "../convex/migrations.ts": () => import("../convex/migrations"),
  "../convex/push.ts": () => import("../convex/push"),
};

export function newTest() {
  return convexTest(schema, modules as Parameters<typeof convexTest>[1]);
}
