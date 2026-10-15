import { afterEach, describe, expect, it, vi } from "vitest";

const sweep = vi.fn();
vi.mock("./lead-push", () => ({ sweepLeadPushes: (...a: unknown[]) => sweep(...a) }));
vi.mock("./db", () => ({ sweepDeps: () => ({ marker: "deps" }) }));

import { runLeadPushSweep } from "./job";

afterEach(() => vi.unstubAllEnvs());

describe("runLeadPushSweep", () => {
  it("does nothing while the flag is off", async () => {
    expect(await runLeadPushSweep()).toEqual({ skipped: "flag off" });
    expect(sweep).not.toHaveBeenCalled();
  });
  it("runs the sweep with the production dependencies when the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTRIBUTION", "1");
    sweep.mockResolvedValue({ contacted: 1, escalated: 2, waiting: 3 });
    expect(await runLeadPushSweep()).toEqual({ contacted: 1, escalated: 2, waiting: 3 });
    expect(sweep).toHaveBeenCalledWith({ marker: "deps" });
  });
});
