import { describe, expect, it, vi } from "vitest";

import { canRevealContact, revealContactField } from "./contact-reveal";

const client = { id: "c1", assignedToId: "rm1", mobile: "9876543123", email: "a@b.com", ckycRef: "50012345678901" };

describe("canRevealContact", () => {
  it("allows an Admin and the assigned RM only", () => {
    expect(canRevealContact({ id: "ad", role: "ADMIN" }, client)).toBe(true);
    expect(canRevealContact({ id: "rm1", role: "RM" }, client)).toBe(true);
    expect(canRevealContact({ id: "rm2", role: "RM" }, client)).toBe(false);
    expect(canRevealContact({ id: "m1", role: "MANAGER" }, client)).toBe(false);
  });
});

describe("revealContactField", () => {
  it("logs who, which field and the client before returning the value", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const out = await revealContactField({ actor: { id: "rm1", role: "RM" }, client, field: "mobile" }, { log });
    expect(out.value).toBe("9876543123");
    expect(log).toHaveBeenCalledWith({ userId: "rm1", entity: "Client", entityId: "c1", fieldName: "mobile", reason: "reveal" });
  });
  it("returns nothing when the log write fails", async () => {
    const log = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(revealContactField({ actor: { id: "ad", role: "ADMIN" }, client, field: "email" }, { log })).rejects.toThrow("db down");
  });
  it("refuses a Manager, another RM and unknown fields without logging", async () => {
    const log = vi.fn();
    await expect(revealContactField({ actor: { id: "m1", role: "MANAGER" }, client, field: "mobile" }, { log })).rejects.toThrow();
    await expect(revealContactField({ actor: { id: "rm2", role: "RM" }, client, field: "mobile" }, { log })).rejects.toThrow();
    await expect(revealContactField({ actor: { id: "ad", role: "ADMIN" }, client, field: "pan" }, { log })).rejects.toThrow("Unknown field");
    expect(log).not.toHaveBeenCalled();
  });
});
