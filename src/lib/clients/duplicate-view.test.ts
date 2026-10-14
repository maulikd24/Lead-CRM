import { describe, expect, it } from "vitest";

import { toBrowserDuplicate } from "./duplicate-view";

const match = { id: "c9", name: "Asha Test", clientCode: "AV-9", mobile: "9876543123", email: "asha@example.com", pan: "ABCDE1234F", assignedToId: "rm-2" };
const res = { duplicate: match, reason: "pan" as const, blocking: true };

describe("toBrowserDuplicate", () => {
  it("masks contacts and never returns the PAN, even for a customer in scope", () => {
    const out = toBrowserDuplicate(res, { role: "ADMIN", visibleUserIds: null });
    const json = JSON.stringify(out);
    for (const raw of ["9876543123", "asha@example.com", "ABCDE1234F"]) expect(json).not.toContain(raw);
    expect(out.duplicate).toMatchObject({ id: "c9", name: "Asha Test", clientCode: "AV-9", mobile: "+91 ••••• ••123" });
    expect(out.blocking).toBe(true);
  });
  it("an RM matching another RM's customer learns only that one exists (code), not who or how to reach them", () => {
    const out = toBrowserDuplicate(res, { role: "RM", visibleUserIds: ["rm-1"] });
    expect(out.duplicate).toEqual({ id: "", name: "An existing customer", clientCode: "AV-9", mobile: null, email: null });
    expect(out.reason).toBe("pan");
  });
  it("an RM sees their own match", () => {
    const out = toBrowserDuplicate(res, { role: "RM", visibleUserIds: ["rm-2"] });
    expect(out.duplicate?.name).toBe("Asha Test");
  });
  it("passes a no-match result through", () => {
    expect(toBrowserDuplicate({ duplicate: null, reason: null, blocking: false }, { role: "RM", visibleUserIds: [] }).duplicate).toBeNull();
  });
});
