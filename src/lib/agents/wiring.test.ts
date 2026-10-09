import { describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/ai/provider";

const buildAgentBriefing = vi.fn(async () => null);
vi.mock("@/lib/intelligence/agent", () => ({ buildAgentBriefing: (...a: unknown[]) => (buildAgentBriefing as (...x: unknown[]) => unknown)(...a) }));
const findSetting = vi.fn(async () => ({ enabled: true }));
const count = vi.fn(async () => 0);
const create = vi.fn(async () => ({ id: "new" }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { agentProposal: { count: (...a: unknown[]) => (count as (...x: unknown[]) => unknown)(...a), create: (...a: unknown[]) => (create as (...x: unknown[]) => unknown)(...a) }, agentSetting: { findUnique: (...a: unknown[]) => (findSetting as (...x: unknown[]) => unknown)(...a) } }, basePrisma: {} }));
vi.mock("@/lib/whatsapp/send", () => ({ queueWhatsAppReply: vi.fn() }));

import { nudgerDeps, batchDeps } from "./wiring";
import { runNudgerBatch } from "./nudger-batch";

describe("nudgerDeps", () => {
  it("builds the briefing without side effects (persist:false), never the persisting default", async () => {
    await nudgerDeps(new FakeProvider("x")).briefing("c1");
    expect(buildAgentBriefing).toHaveBeenCalledWith("c1", { persist: false });
  });

  it("flag off + unknown AI_PROVIDER: the batch returns zeros and does not throw", async () => {
    vi.stubEnv("AI_PROVIDER", "mystery");
    vi.stubEnv("AGENT_NUDGER_ENABLED", "");
    expect(await runNudgerBatch(10, batchDeps())).toEqual({ drafted: 0, blocked: 0, skipped: 0, failed: 0 });
    vi.unstubAllEnvs();
  });

  const proposal = { agentKey: "wa_nudger", clientId: "c1", status: "DRAFT" } as never;
  it("save skips the insert when an unexpired DRAFT or an APPROVED proposal already exists", async () => {
    count.mockResolvedValueOnce(1);
    expect(await nudgerDeps(new FakeProvider("x")).save(proposal)).toEqual({ duplicate: true });
    expect(create).not.toHaveBeenCalled();
  });
  it("save inserts when nothing is open", async () => {
    count.mockResolvedValueOnce(0);
    expect(await nudgerDeps(new FakeProvider("x")).save(proposal)).toEqual({ id: "new" });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
