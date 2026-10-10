import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { leadIntake: { findUnique: (a: unknown) => findUnique(a), create: (a: unknown) => create(a) } } }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: vi.fn() }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));

import { ingestLead } from "./ingest";
import { erasedLedgerKey } from "@/lib/privacy/erased-key";

const input = { source: "allvest_app", externalId: "user-12345", leadSource: "App", name: "A B", phone: "9876501234" };

describe("ingestLead after an erasure", () => {
  beforeEach(() => { findUnique.mockReset(); create.mockReset(); });

  it("acknowledges a replayed signup of an erased person as a replay and never recreates anything", async () => {
    findUnique.mockImplementation(async ({ where }: { where: { source_externalId: { externalId: string } } }) =>
      where.source_externalId.externalId === erasedLedgerKey("allvest_app", "user-12345") ? { id: "t", status: "CREATED", clientId: null } : null);
    const out = await ingestLead(input, { whatever: true });
    expect(out).toEqual({ status: "replay", previous: "REJECTED" });
    expect(create).not.toHaveBeenCalled();
  });
});
