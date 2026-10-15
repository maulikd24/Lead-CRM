import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(async () => ({ user: { id: "u1", role: "MANAGER" } })),
  answerQuestion: vi.fn(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/auth/require-role", () => ({ requireAccess: mocks.requireAccess }));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: async () => null }));
vi.mock("@/lib/intelligence/management", () => ({ managementScope: () => ({}) }));
vi.mock("@/lib/intelligence/ask-intents", () => ({ answerQuestion: mocks.answerQuestion, SUPPORTED_QUESTIONS: [] }));

import { answerManagementQuestionAction } from "./actions";
import ManagementIntelligencePage from "./page";

const saved = process.env.MANAGEMENT_INTEL_ENABLED;

beforeEach(() => {
  mocks.requireAccess.mockClear();
  mocks.answerQuestion.mockClear();
});
afterEach(() => {
  if (saved === undefined) delete process.env.MANAGEMENT_INTEL_ENABLED;
  else process.env.MANAGEMENT_INTEL_ENABLED = saved;
});

describe("management page and Ask are gated like gate.ts", () => {
  it("the Ask action asks for the management-intelligence area, then refuses when the flag is off", async () => {
    delete process.env.MANAGEMENT_INTEL_ENABLED;
    await expect(answerManagementQuestionAction("Which KYC customers have not funded?")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAccess).toHaveBeenCalledWith("management-intelligence");
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("the Ask action answers when the flag is on", async () => {
    process.env.MANAGEMENT_INTEL_ENABLED = "1";
    await answerManagementQuestionAction("Which KYC customers have not funded?");
    expect(mocks.answerQuestion).toHaveBeenCalledTimes(1);
  });

  it("the page is not found when the flag is off, and reads no data", async () => {
    delete process.env.MANAGEMENT_INTEL_ENABLED;
    await expect(ManagementIntelligencePage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAccess).toHaveBeenCalledWith("management-intelligence");
  });
});
