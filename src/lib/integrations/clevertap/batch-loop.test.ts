import { describe, expect, it, vi } from "vitest";
import { runBatch } from "./batch-loop";

describe("runBatch", () => {
  it("counts each status", async () => {
    const seq = ["pushed", "unchanged", "skipped", "failed"] as const;
    const res = await runBatch(["a", "b", "c", "d"], async (id) => ({ status: seq[["a", "b", "c", "d"].indexOf(id)] }));
    expect(res).toEqual({ pushed: 1, unchanged: 1, skipped: 1, retry: 0, failed: 1 });
  });
  it("stops at the first retry", async () => {
    const calls: string[] = [];
    const res = await runBatch(["a", "b", "c"], async (id) => { calls.push(id); return { status: id === "b" ? "retry" : "pushed" }; });
    expect(calls).toEqual(["a", "b"]);
    expect(res).toEqual({ pushed: 1, unchanged: 0, skipped: 0, retry: 1, failed: 0 });
  });
  it("one throwing customer does not stop the rest", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runBatch(["a", "b", "c"], async (id) => { if (id === "b") throw new Error("x"); return { status: "pushed" }; });
    expect(res).toEqual({ pushed: 2, unchanged: 0, skipped: 0, retry: 0, failed: 1 });
    spy.mockRestore();
  });
});
