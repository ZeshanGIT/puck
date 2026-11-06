import { describe, expect, test } from "bun:test";
import {
  ARM_MS,
  armReducer,
  type ArmClock,
  type ArmState,
  createArmStore,
  haptics,
  IDLE_ARM,
} from "./useTapTwice";

/** A clock and timer scheduler the test drives by hand. */
function fakeClock() {
  let time = 1000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: ArmClock = {
    now: () => time,
    setTimer(fn, ms) {
      const handle = nextHandle++;
      timers.set(handle, { at: time + ms, fn });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    pending: () => timers.size,
    advance(ms: number) {
      time += ms;
      for (const [handle, t] of [...timers]) {
        if (t.at <= time) {
          timers.delete(handle);
          t.fn();
        }
      }
    },
  };
}

describe("armReducer", () => {
  test("the first tap arms", () => {
    const r = armReducer(IDLE_ARM, { type: "press", id: "a", now: 100 });
    expect(r.effect).toBe("arm");
    expect(r.state).toEqual({ armedId: "a", armedAt: 100 });
  });

  test("a second tap on the same control inside the window fires and disarms", () => {
    const armed: ArmState = { armedId: "a", armedAt: 100 };
    const r = armReducer(armed, { type: "press", id: "a", now: 100 + ARM_MS - 1 });
    expect(r.effect).toBe("fire");
    expect(r.state).toBe(IDLE_ARM);
  });

  test("a tap once the window has run out arms again instead of firing", () => {
    const armed: ArmState = { armedId: "a", armedAt: 100 };
    const r = armReducer(armed, { type: "press", id: "a", now: 100 + ARM_MS });
    expect(r.effect).toBe("arm");
    expect(r.state).toEqual({ armedId: "a", armedAt: 100 + ARM_MS });
  });

  test("tapping another control moves the arm without firing", () => {
    const armed: ArmState = { armedId: "a", armedAt: 100 };
    const r = armReducer(armed, { type: "press", id: "b", now: 500 });
    expect(r.effect).toBe("arm");
    expect(r.state).toEqual({ armedId: "b", armedAt: 500 });
  });

  test("disarm clears the armed control, but only the one named", () => {
    const armed: ArmState = { armedId: "a", armedAt: 100 };
    expect(armReducer(armed, { type: "disarm", id: "b" }).state).toBe(armed);
    expect(armReducer(armed, { type: "disarm", id: "a" }).state).toBe(IDLE_ARM);
    expect(armReducer(armed, { type: "disarm" }).state).toBe(IDLE_ARM);
    expect(armReducer(IDLE_ARM, { type: "disarm" }).state).toBe(IDLE_ARM);
  });
});

describe("createArmStore", () => {
  test("arms on the first tap and fires on the second", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    expect(store.press("send")).toBe("arm");
    expect(store.getState().armedId).toBe("send");
    expect(store.getState().armedAt).toBe(1000);
    f.advance(1500);
    expect(store.press("send")).toBe("fire");
    expect(store.getState().armedId).toBeNull();
    expect(f.pending()).toBe(0);
  });

  test("disarms by itself when the window expires, and the next tap arms again", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    store.press("send");
    f.advance(ARM_MS - 1);
    expect(store.getState().armedId).toBe("send");
    f.advance(1);
    expect(store.getState().armedId).toBeNull();
    expect(store.press("send")).toBe("arm");
  });

  test("arming another control in the group disarms the first", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    store.press("one");
    f.advance(1000);
    expect(store.press("two")).toBe("arm");
    expect(store.getState().armedId).toBe("two");
    // The first control's window is gone: tapping it arms it, it does not fire.
    expect(store.press("one")).toBe("arm");
    expect(store.getState().armedId).toBe("one");
    // Only one expiry timer is ever pending, and it belongs to the latest arm.
    expect(f.pending()).toBe(1);
  });

  test("the first control's old timer does not disarm the second", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    store.press("one");
    f.advance(3000);
    store.press("two");
    f.advance(2000); // past one's original expiry at 4000
    expect(store.getState().armedId).toBe("two");
    f.advance(2000); // two's own expiry
    expect(store.getState().armedId).toBeNull();
  });

  test("disarm clears the timer; disarming a control that is not armed does nothing", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    store.press("one");
    store.disarm("two");
    expect(store.getState().armedId).toBe("one");
    store.disarm("one");
    expect(store.getState().armedId).toBeNull();
    expect(f.pending()).toBe(0);
  });

  test("notifies subscribers on arm, move, fire and expiry, and stops after unsubscribe", () => {
    const f = fakeClock();
    const store = createArmStore(f.clock);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.press("a"); // arm
    store.press("b"); // move
    store.press("b"); // fire
    expect(calls).toBe(3);
    store.press("a");
    f.advance(ARM_MS); // expiry
    expect(calls).toBe(5);
    off();
    store.press("a");
    expect(calls).toBe(5);
  });
});

describe("haptics", () => {
  test("never throw where expo-haptics is unavailable", async () => {
    expect(() => {
      haptics.tick();
      haptics.confirm();
      haptics.error();
    }).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
