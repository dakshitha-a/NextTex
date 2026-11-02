import { describe, expect, it } from "vitest";
import { singleFlight } from "./single-flight";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

describe("singleFlight", () => {
  it("runs a burst of calls as one call and one trailing call", async () => {
    const gates = [gate(), gate()];
    let calls = 0;
    const refresh = singleFlight(async () => {
      const mine = gates[calls];
      calls += 1;
      await mine.opened;
    });
    const promises = Array.from({ length: 10 }, () => refresh());
    expect(calls).toBe(1);
    gates[0].open();
    await promises[0];
    await Promise.resolve();
    expect(calls).toBe(2);
    gates[1].open();
    await Promise.all(promises);
    expect(calls).toBe(2);
  });

  it("starts at once when nothing is running", async () => {
    let calls = 0;
    const refresh = singleFlight(async () => { calls += 1; });
    await refresh();
    await refresh();
    expect(calls).toBe(2);
  });

  it("still runs the trailing call when the running one fails", async () => {
    let calls = 0;
    const first = gate();
    const refresh = singleFlight(async () => {
      calls += 1;
      if (calls === 1) {
        await first.opened;
        throw new Error("offline");
      }
    });
    const failing = refresh();
    const trailing = refresh();
    first.open();
    await expect(failing).rejects.toThrow("offline");
    await trailing;
    expect(calls).toBe(2);
  });
});
