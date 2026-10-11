import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { ALL_ROLES, can } from "@/lib/access/policy";

import { SEARCH_SOURCES, universalSearch, type SearchDeps, type SearchKind } from "./universal-search";

const ROLES = ALL_ROLES;
const ALL_KINDS = Object.keys(SEARCH_SOURCES) as SearchKind[];

function makeDeps(over: Partial<SearchDeps> = {}) {
  const deps = {
    visibleUserIds: vi.fn(async () => null as string[] | null),
    partnerScope: vi.fn(async () => ({ kind: "all" as const })),
    customers: vi.fn(async () => [{ id: "c1", name: "Riya Shah", clientCode: "C-1", mobile: "9999900000" }]),
    tasks: vi.fn(async () => [{ id: "t1", title: "Call Riya Shah about SIP", status: "PENDING", dueAt: new Date("2026-10-12T00:00:00Z"), clientId: "c1", clientName: "Riya Shah" }]),
    campaigns: vi.fn(async () => [{ name: "Diwali SIP", provider: "meta" }]),
    partners: vi.fn(async () => [{ id: "p1", code: "PTR-1", name: "Asha IFA" }]),
    tickets: vi.fn(async () => [{ id: "k1", subject: "Statement not received", clientId: "c1", clientName: "Riya Shah" }]),
    ...over,
  } satisfies SearchDeps;
  return deps;
}
const FLAGS = ["partner-workspace", "marketing"];
const search = (role: Role, q = "ri", deps = makeDeps(), flags = FLAGS) => universalSearch({ id: "u1", role }, q, flags, deps).then((hits) => ({ hits, deps }));

describe("universal search never returns what the role cannot open", () => {
  it("each source answers only roles the central registry allows, and is never even queried for the others", async () => {
    for (const role of ROLES) {
      const { hits, deps } = await search(role);
      for (const kind of ALL_KINDS) {
        const allowed = can(role, SEARCH_SOURCES[kind].area, "view");
        expect(hits.some((h) => h.kind === kind), `${role} ${kind}`).toBe(allowed);
        const fn = { customer: deps.customers, task: deps.tasks, campaign: deps.campaigns, partner: deps.partners, ticket: deps.tickets }[kind];
        expect(fn.mock.calls.length > 0, `${role} ${kind} queried`).toBe(allowed);
      }
    }
  });
  it("marketing finds campaigns and its own tasks, and never a customer, ticket or partner", async () => {
    const { hits } = await search("MARKETING");
    expect(hits.map((h) => h.kind).sort()).toEqual(["campaign", "task"]);
  });
  it("marketing's task result is pseudonymised: no customer name, no client link, even though the task title mentions one", async () => {
    const { hits } = await search("MARKETING");
    const t = hits.find((h) => h.kind === "task")!;
    expect(t.sublabel).not.toContain("Riya");
    expect(t.href).toBe("/tasks");
    expect(t.label).not.toContain("Riya");
  });
  it("a desk role sees the customer link on its task and ticket hits", async () => {
    const { hits } = await search("RM");
    expect(hits.find((h) => h.kind === "task")?.href).toBe("/clients/c1");
    expect(hits.find((h) => h.kind === "ticket")?.href).toBe("/clients/c1");
    expect(hits.some((h) => h.kind === "campaign")).toBe(false);
  });
  it("partner roles search only partners inside their own scope (the scope reaches the query)", async () => {
    const scope = { kind: "ids" as const, ids: ["p9"], detailIds: ["p9"] };
    const deps = makeDeps({ partnerScope: vi.fn(async () => scope) });
    await search("PARTNER", "as", deps);
    expect(deps.partners).toHaveBeenCalledWith("as", scope);
    const none = makeDeps({ partnerScope: vi.fn(async () => null as never) });
    expect((await search("PARTNER", "as", none)).hits.some((h) => h.kind === "partner")).toBe(false);
  });
  it("customer and ticket queries get the viewer's visibility scope", async () => {
    const deps = makeDeps({ visibleUserIds: vi.fn(async () => ["u1"]) });
    await search("RM", "ri", deps);
    expect(deps.customers).toHaveBeenCalledWith("ri", ["u1"]);
    expect(deps.tickets).toHaveBeenCalledWith("ri", ["u1"]);
  });
  it("a flag that is off removes its sources (partners, campaigns) for every role, admin included", async () => {
    const { hits, deps } = await search("ADMIN", "ri", makeDeps(), []);
    expect(hits.some((h) => h.kind === "partner" || h.kind === "campaign")).toBe(false);
    expect(deps.partners).not.toHaveBeenCalled();
    expect(deps.campaigns).not.toHaveBeenCalled();
  });
  it("short queries return nothing and query nothing", async () => {
    const { hits, deps } = await search("ADMIN", "r");
    expect(hits).toEqual([]);
    expect(deps.customers).not.toHaveBeenCalled();
  });
  it("a failing source never takes the others down", async () => {
    const deps = makeDeps({ campaigns: vi.fn(async () => { throw new Error("db down"); }) });
    const { hits } = await search("ADMIN", "ri", deps);
    expect(hits.some((h) => h.kind === "customer")).toBe(true);
  });
});
