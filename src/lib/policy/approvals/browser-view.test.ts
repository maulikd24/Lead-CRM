import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { toBrowserApprovals } from "./browser-view";

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1", actionType: "CLIENT_MOBILE_CHANGE", entity: "Client", entityId: "c1", status: "PENDING",
  payload: { clientId: "c1", newMobile: "9876543123" }, requestedBy: { name: "Rm One" }, ...over,
});

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([{ id: "c1", name: "Asha Test", clientCode: "AV-1", mobile: "9000000456" }]);
});

describe("toBrowserApprovals", () => {
  it("never lets a raw number into the browser payload and shows the customer name with the old and new masked numbers", async () => {
    const [out] = await toBrowserApprovals([row()] as never);
    const json = JSON.stringify(out);
    expect(json).not.toContain("9876543123");
    expect(json).not.toContain("9000000456");
    expect(out.payload).toMatchObject({ newMobileMasked: "+91 ••••• ••123", oldMobileMasked: "+91 ••••• ••456", clientName: "Asha Test", clientCode: "AV-1" });
  });
  it("leaves other approval kinds untouched", async () => {
    const other = row({ actionType: "STAGE_OVERRIDE", payload: { a: 1 } });
    const [out] = await toBrowserApprovals([other] as never);
    expect(out.payload).toEqual({ a: 1 });
  });
  it("copes with a customer that no longer exists", async () => {
    findMany.mockResolvedValue([]);
    const [out] = await toBrowserApprovals([row()] as never);
    expect(out.payload).toMatchObject({ newMobileMasked: "+91 ••••• ••123", clientName: null });
  });
});
