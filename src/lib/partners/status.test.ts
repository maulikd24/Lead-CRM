import { describe, expect, it } from "vitest";

import { dataStatus } from "./status";

const ok = (source: "native" | "sample") => ({ status: "ok" as const, data: 1, sample: source === "sample", source });

describe("dataStatus", () => {
  it("says sample data plainly", () => {
    expect(dataStatus(ok("sample"))).toMatchObject({ key: "sample", tone: "warning" });
  });
  it("native data is live and trusted: it is this CRM's own records", () => {
    const s = dataStatus(ok("native"));
    expect(s).toMatchObject({ key: "native", tone: "success" });
    expect(JSON.stringify(s)).not.toMatch(/contract|verified|referral api/i);
  });
  it("covers not connected and errors without leaking internals", () => {
    expect(dataStatus({ status: "not_connected" }).key).toBe("not_connected");
    expect(dataStatus({ status: "not_connected" }).hint).not.toMatch(/referral api|integration/i);
    const err = dataStatus({ status: "error", kind: "server" });
    expect(err).toMatchObject({ key: "error", tone: "destructive" });
    expect(JSON.stringify(err)).not.toMatch(/token|stack|prisma/i);
  });
});
