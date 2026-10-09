import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/clients/inbound-contact", () => ({ resolveInboundClient: vi.fn() }));
vi.mock("@/lib/intelligence/extract", () => ({ saveExtraction: vi.fn() }));
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: vi.fn() }));
import { maybeHandleHandoff } from "./deps";
import type { HandoffDeps } from "./handoff";

const body = { ticket_id: "9", requester_email: "a@b.co", tags: "ai_handoff", ai_summary: "s", updated_at: "2026-10-07T00:00:00Z" };
const deps = () => {
  const d = {
    now: () => new Date("2026-10-07T00:00:00Z"),
    resolveClient: vi.fn(async () => ({ id: "c", assignedToId: "r", name: "n" })),
    findExisting: vi.fn(async () => null),
    createActivity: vi.fn(async () => ({ id: "a" })),
    updateActivity: vi.fn(),
    createTask: vi.fn(async () => ({ id: "t" })),
    recordServiceIssue: vi.fn(),
    log: vi.fn(),
  };
  return d as typeof d & HandoffDeps;
};

afterEach(() => vi.unstubAllEnvs());

describe("maybeHandleHandoff gating", () => {
  it("flag off: returns null and touches nothing", async () => {
    const d = deps();
    expect(await maybeHandleHandoff("freshdesk", body, d)).toBeNull();
    expect(d.resolveClient).not.toHaveBeenCalled();
  });
  it("flag on but another provider or an ordinary ticket: null", async () => {
    vi.stubEnv("FRESHDESK_HANDOFF_ENABLED", "1");
    const d = deps();
    expect(await maybeHandleHandoff("exotel", body, d)).toBeNull();
    expect(await maybeHandleHandoff("freshdesk", { ticket_id: 1, tags: "vip" }, d)).toBeNull();
    expect(d.resolveClient).not.toHaveBeenCalled();
  });
  it("flag on and a hand-off: processed", async () => {
    vi.stubEnv("FRESHDESK_HANDOFF_ENABLED", "1");
    const d = deps();
    expect(await maybeHandleHandoff("freshdesk", body, d)).toMatchObject({ status: "created" });
    expect(d.createTask).toHaveBeenCalledOnce();
  });
  it("any value other than 1 keeps it off", async () => {
    vi.stubEnv("FRESHDESK_HANDOFF_ENABLED", "true");
    expect(await maybeHandleHandoff("freshdesk", body, deps())).toBeNull();
  });
});
