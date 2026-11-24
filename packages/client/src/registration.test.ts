import { expect, test } from "bun:test";
import { ensureClientRegistered, registerAnotherName, replaceClient, type RegistrationDeps } from "./index";

test("registration keeps a stored client on the authenticated account", async () => {
  const touched: string[] = [];
  const deps: RegistrationDeps = {
    platform: "macos",
    readClientId: async () => "this-mac",
    listClients: async () => [{ id: "this-mac" }],
    touch: async (id) => { touched.push(id); },
    clearClientId: async () => { throw new Error("unexpected clear"); },
    register: async () => { throw new Error("unexpected register"); },
    saveClientId: async () => { throw new Error("unexpected save"); },
  };

  expect(await ensureClientRegistered(deps, "Mac")).toEqual({ kind: "ready", clientId: "this-mac" });
  expect(touched).toEqual(["this-mac"]);
});

test("registration clears a stale id and waits for explicit conflict resolution", async () => {
  const calls: string[] = [];
  const deps: RegistrationDeps = {
    platform: "macos",
    readClientId: async () => "stale",
    listClients: async () => [],
    touch: async () => { throw new Error("unexpected touch"); },
    clearClientId: async () => { calls.push("clear"); },
    register: async ({ name, platform, replace }) => {
      calls.push(`register ${platform} ${name}`);
      if (replace) return { status: "replaced", clientId: "old-row" };
      if (name === "Mac (3)") return { status: "created", clientId: "new-row" };
      return { status: "exists", clientId: "old-row" };
    },
    saveClientId: async (id) => { calls.push(`save ${id}`); },
  };

  expect(await ensureClientRegistered(deps, "Mac")).toEqual({ kind: "conflict", name: "Mac" });
  expect(calls).toEqual(["clear", "register macos Mac"]);

  expect(await replaceClient(deps, "Mac")).toEqual({ kind: "ready", clientId: "old-row" });
  expect(await registerAnotherName(deps, "Mac")).toEqual({ kind: "ready", clientId: "new-row" });
  expect(calls.slice(2)).toEqual([
    "register macos Mac", "save old-row", "register macos Mac (2)", "register macos Mac (3)", "save new-row",
  ]);
});
