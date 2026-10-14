import { describe, expect, it, vi } from "vitest";

const call = { id: "s1", clientId: "c1", userId: "u1", status: "IN_PROGRESS", mock: true, startedAt: new Date(), answeredAt: null, endedAt: null, durationSeconds: null };
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    callSession: { findFirst: async () => call },
    // Honours `select`, as the real client does: a column that is not selected is not returned.
    client: { findUnique: async ({ select }: { select: Record<string, boolean> }) => Object.fromEntries(Object.entries({ id: "c1", name: "Asha Test", mobile: "9876543123" }).filter(([k]) => select[k])) },
  },
}));
vi.mock("@/lib/auth/require-role", () => ({ requireUser: async () => ({ user: { id: "u1", role: "RM" } }), requireRole: async () => ({ user: { id: "u1", role: "RM" } }) }));
vi.mock("@/lib/click-to-call/sessions", () => ({ advanceMockCall: async (r: unknown) => r, activeCallFor: async () => null, completeCallSession: async () => undefined }));
vi.mock("@/lib/clients/load-in-scope", () => ({ DESK_ROLES: ["ADMIN", "MANAGER", "RM"], loadClientInScope: async () => ({}) }));
vi.mock("@/lib/integrations/registry", () => ({ getAdapter: async () => ({}), isMockAdapter: () => true }));
vi.mock("@/lib/security/webhook-auth", () => ({ isProductionRuntime: () => false }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/consent/enforce", () => ({ checkConsent: async () => ({ allowed: true }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { getCallSessionAction } from "./actions";

describe("getCallSessionAction", () => {
  it("returns the customer's name for the widget but never the number (dialling is server-side)", async () => {
    const view = await getCallSessionAction("s1");
    expect(view?.client?.name).toBe("Asha Test");
    expect(JSON.stringify(view)).not.toContain("9876543123");
  });
});
