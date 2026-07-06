import { describe, expect, it } from "vitest";
import { cached } from "./cache";

describe("cached", () => {
  it("only invokes fn once per key within the TTL window", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return `value-${calls}`;
    };
    const a = await cached("test-key-1", 60_000, fn);
    const b = await cached("test-key-1", 60_000, fn);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("invokes fn again for a different key", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };
    await cached("test-key-2a", 60_000, fn);
    await cached("test-key-2b", 60_000, fn);
    expect(calls).toBe(2);
  });

  it("invokes fn again once the TTL has expired", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return calls;
    };
    await cached("test-key-3", 10, fn);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cached("test-key-3", 10, fn);
    expect(calls).toBe(2);
  });
});
