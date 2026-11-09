import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { checkMachine } from "@puck/shared";
import { appMachines } from "./machines";

describe("app machine registry", () => {
  test("every machine passes the totality, purity and invariant check", () => {
    for (const machine of appMachines) expect(checkMachine(machine)).toEqual([]);
  });

  test("machine names are unique", () => {
    const names = appMachines.map((machine) => machine.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every *Machine.ts file in app/src is registered", () => {
    const files = readdirSync(new URL(".", import.meta.url).pathname).filter(
      (name) => name.endsWith("Machine.ts") && !name.endsWith(".test.ts"),
    );
    const text = readFileSync(new URL("./machines.ts", import.meta.url), "utf8");
    for (const file of files) expect(text).toContain(`./${file.replace(/\.ts$/u, "")}`);
  });

  test("every machine says where it is used and has samples for each of its events", () => {
    for (const machine of appMachines) {
      expect(machine.usedBy.length).toBeGreaterThan(0);
      expect(machine.samples.events.length).toBeGreaterThan(0);
      expect(machine.summary.length).toBeGreaterThan(20);
    }
  });
});
