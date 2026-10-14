import { describe, expect, it, vi } from "vitest";

const client = {
  id: "c1", clientCode: "AV-1", name: "Asha Test", mobile: "9876543123", email: "asha@example.com", pan: "ABCDE1234F", ckycRef: "CK123456789",
  region: null, currentStageId: "s1", currentStage: { name: "New Lead", slaHours: 24 }, stageEnteredAt: new Date("2026-10-01"), leadSource: "Web",
  priority: "MEDIUM", status: "ACTIVE", assignedTo: { name: "Rm One" }, createdAt: new Date("2026-10-01"), updatedAt: new Date("2026-10-02"),
};
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findMany: async () => [client] }, exception: { findMany: async () => [] } } }));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: async () => ({ user: { id: "u1", role: "MANAGER", name: "M" } }) }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => null }));
vi.mock("@/lib/activity/log-user-event", () => ({ logExport: async () => undefined }));

import { GET } from "./route";

describe("GET /api/clients/export", () => {
  it("never puts a raw mobile, email, PAN or CKYC reference in the CSV", async () => {
    const res = await GET(new Request("http://localhost/api/clients/export"));
    const csv = await res.text();
    for (const raw of ["9876543123", "asha@example.com", "ABCDE1234F", "CK123456789"]) expect(csv).not.toContain(raw);
    expect(csv).toContain("+91 ••••• ••123");
    expect(csv).toContain("a•••@example.com");
    expect(csv).not.toMatch(/pan/i);
  });
});
