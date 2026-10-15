import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: { dataAccessLog: { create: vi.fn() } } }));

import type { Role } from "@/generated/prisma/client";

import { applyMasking, CLIENT_MASK_RULES } from "./masking";

const row = { pan: "ABCDE1234F", mobile: "9876543123", email: "asha.rao@example.com" };

describe("CLIENT_MASK_RULES (partner views of referred customers)", () => {
  it.each(["ADMIN", "MANAGER", "RM", "PARTNER", "DISTRIBUTOR", "AFFILIATE"] as Role[])("%s never gets a raw PAN, mobile or email, and the forms match the shared contact mask", (role) => {
    const out = applyMasking(row, { id: "u1", role }, CLIENT_MASK_RULES, { entity: "Client", entityId: "c1" });
    expect(JSON.stringify(out)).not.toMatch(/ABCDE1234F|9876543123|asha\.rao/);
    expect(out).toEqual({ pan: "••••••234F", mobile: "+91 ••••• ••123", email: "a•••@example.com" });
  });
});
