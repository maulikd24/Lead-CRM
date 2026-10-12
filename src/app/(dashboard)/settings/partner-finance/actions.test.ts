import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const approvalFindUnique = vi.fn();
const auditCreate = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { approvalRequest: { findUnique: (...a: unknown[]) => approvalFindUnique(...a) }, auditLog: { create: (...a: unknown[]) => auditCreate(...a) } } }));
const proposeTax = vi.fn();
const proposeOverride = vi.fn();
vi.mock("@/lib/partners/tax/store", async (orig) => ({ ...(await orig<object>()), proposeTaxRuleChange: (...a: unknown[]) => proposeTax(...a) }));
vi.mock("@/lib/partners/overrides/store", async (orig) => ({ ...(await orig<object>()), proposeOverrideRuleChange: (...a: unknown[]) => proposeOverride(...a) }));
const saveSetting = vi.fn();
vi.mock("@/lib/partners/settings", async (orig) => ({ ...(await orig<object>()), saveWorkspaceSetting: (...a: unknown[]) => saveSetting(...a) }));
const generate = vi.fn();
vi.mock("@/lib/partners/overrides/generate", () => ({ generateOverrideAccruals: (...a: unknown[]) => generate(...a) }));
const decideApproval = vi.fn();
vi.mock("@/lib/policy/approvals/service", async (orig) => ({ ...(await orig<object>()), decideApproval: (...a: unknown[]) => decideApproval(...a), requestApproval: vi.fn() }));

import { ApprovalBlockedError } from "@/lib/policy/approvals/service";
import { decideRuleChangeAction, generateOverridesAction, proposeOverrideRuleAction, proposeTaxRuleAction, saveSettingAction } from "./actions";

const ALL_ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
const ALLOWED = ["ADMIN", "FINANCE"];
const create = { op: "create" as const, rule: { kind: "TDS", label: "Section X", ratePercent: "5", effectiveFrom: "2026-11-01" } };

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "1");
  proposeTax.mockResolvedValue({ ok: true, requestId: "r1", summary: "Add tax rule" });
  proposeOverride.mockResolvedValue({ ok: true, requestId: "r2", summary: "Add override rule" });
  saveSetting.mockResolvedValue({ ok: true });
  generate.mockResolvedValue({ rules: 1, sources: 3, created: 2, updated: 0, unchanged: 0 });
  approvalFindUnique.mockResolvedValue({ actionType: "PARTNER_TAX_RULE_CHANGE" });
  decideApproval.mockResolvedValue(undefined);
});

describe.each([
  ["proposeTaxRuleAction", () => proposeTaxRuleAction(create), proposeTax],
  ["proposeOverrideRuleAction", () => proposeOverrideRuleAction({ op: "create", rule: { level: "1" } }), proposeOverride],
  ["saveSettingAction", () => saveSettingAction("letterhead", { lines: ["Firm"] }), saveSetting],
  ["generateOverridesAction", () => generateOverridesAction(), generate],
  ["decideRuleChangeAction", () => decideRuleChangeAction("r1", "APPROVED"), decideApproval],
] as const)("%s", (_name, call, target) => {
  it.each(ALL_ROLES)("%s: only admin and finance may use it", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => call() as Promise<unknown>);
    expect(r.kind === "redirect").toBe(!ALLOWED.includes(role));
    if (!ALLOWED.includes(role)) expect(target).not.toHaveBeenCalled();
  });
  it("sends a signed-out visitor away and is a 404 while the flag is off", async () => {
    asAnonymous();
    expect((await outcomeOf(() => call() as Promise<unknown>)).kind).toBe("redirect");
    asUser({ role: "ADMIN" });
    vi.stubEnv("PARTNER_WORKSPACE_ENABLED", "");
    expect(await outcomeOf(() => call() as Promise<unknown>)).toEqual({ kind: "notFound" });
    expect(target).not.toHaveBeenCalled();
  });
});

describe("what the actions pass on", () => {
  it("proposals go to the store as the signed-in user, with the change as sent", async () => {
    const u = asUser({ role: "FINANCE" });
    expect(await proposeTaxRuleAction(create)).toEqual({ ok: true, requestId: "r1", summary: "Add tax rule" });
    expect(proposeTax).toHaveBeenCalledWith(expect.anything(), { id: u.id, role: "FINANCE" }, create, expect.any(Date));
  });
  it("a malformed change is refused before the store", async () => {
    asUser({ role: "FINANCE" });
    expect(await proposeTaxRuleAction({ op: "delete" } as never)).toMatchObject({ ok: false });
    expect(await proposeTaxRuleAction(null as never)).toMatchObject({ ok: false });
    expect(proposeTax).not.toHaveBeenCalled();
  });
  it("settings are saved as the signed-in user", async () => {
    const u = asUser({ role: "ADMIN" });
    await saveSettingAction("referral", { linkBase: "https://x.test/j", lapseDays: "60" });
    expect(saveSetting).toHaveBeenCalledWith(expect.anything(), { id: u.id }, "referral", { linkBase: "https://x.test/j", lapseDays: "60" });
  });
  it("generating override accruals is audited with the counts", async () => {
    const u = asUser({ role: "FINANCE" });
    const r = await generateOverridesAction();
    expect(r).toMatchObject({ created: 2 });
    expect(auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: u.id, action: "partner_override_accruals_generated", newValue: { rules: 1, sources: 3, created: 2, updated: 0, unchanged: 0 } }) });
  });
});

describe("decideRuleChangeAction: only the partner rule changes, by a different person", () => {
  it("decides a tax or override rule change as the signed-in user", async () => {
    const u = asUser({ role: "FINANCE" });
    expect(await decideRuleChangeAction("r1", "APPROVED", "ok")).toEqual({ ok: true });
    expect(decideApproval).toHaveBeenCalledWith("r1", "APPROVED", "ok", { id: u.id, role: "FINANCE" });
  });
  it("refuses any other kind of approval request: this is not a back door to the rest", async () => {
    asUser({ role: "ADMIN" });
    approvalFindUnique.mockResolvedValue({ actionType: "ERASURE_REQUEST" });
    expect(await decideRuleChangeAction("r9", "APPROVED")).toMatchObject({ ok: false });
    expect(decideApproval).not.toHaveBeenCalled();
    approvalFindUnique.mockResolvedValue(null);
    expect(await decideRuleChangeAction("nope", "APPROVED")).toMatchObject({ ok: false });
  });
  it("returns the service's refusal (the same person, a request already decided) as a plain message", async () => {
    asUser({ role: "FINANCE" });
    decideApproval.mockRejectedValue(new Error("Maker cannot also be checker of their own request"));
    expect(await decideRuleChangeAction("r1", "APPROVED")).toEqual({ ok: false, error: "Maker cannot also be checker of their own request" });
  });
  it("returns a blocked approval's reasons", async () => {
    asUser({ role: "FINANCE" });
    decideApproval.mockRejectedValue(new ApprovalBlockedError("This rule change can no longer be applied.", ["It overlaps another tax rule."]));
    expect(await decideRuleChangeAction("r1", "APPROVED")).toEqual({ ok: false, error: "This rule change can no longer be applied. It overlaps another tax rule." });
  });
});
