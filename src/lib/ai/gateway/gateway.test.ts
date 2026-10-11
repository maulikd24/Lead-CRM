import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";

import { callModel } from "./gateway";
import { getPurpose } from "./purposes";
import { makeDeps } from "./test-kit";
import { NotConfiguredError } from "./types";
import type { PurposeDef } from "./purposes";

const ok = { purpose: "social.draft", system: "sys", user: "write a post" };

describe("callModel: purpose is required and registered", () => {
  it("refuses an unregistered purpose, calls nothing, and still leaves a trace", async () => {
    const { deps, records, fake } = makeDeps();
    const r = await callModel({ purpose: "made.up", user: "x" }, deps);
    expect(r).toMatchObject({ kind: "blocked", reason: "purpose_unregistered" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
    expect(records[0]).toMatchObject({ status: "blocked", reasonCode: "purpose_unregistered", purposeId: "made.up" });
  });
  it("refuses a call with nothing to send", async () => {
    const { deps } = makeDeps();
    expect(await callModel({ purpose: "social.draft" }, deps)).toMatchObject({ kind: "blocked", reason: "invalid_input" });
  });
});

describe("callModel: kill switches", () => {
  it("the global kill switch blocks every purpose before anything else", async () => {
    const { deps, fake } = makeDeps({ env: { AI_KILL_SWITCH: "1", AI_BUDGET_DEFAULT_USD: "100" } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "kill_switch" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("only the exact value 1 counts as the global kill", async () => {
    const { deps } = makeDeps({ env: { AI_KILL_SWITCH: "true", AI_BUDGET_DEFAULT_USD: "100" } });
    expect((await callModel(ok, deps)).kind).toBe("ok");
  });
  it("an agent's own kill switch (flag and setting) blocks that agent's purposes", async () => {
    const { deps, fake } = makeDeps({ agentEnabled: async (k) => k !== "social_drafter" });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "kill_switch" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("a kill-switch lookup that throws fails closed", async () => {
    const { deps } = makeDeps({ agentEnabled: async () => { throw new Error("db down"); } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "kill_switch" });
  });
});

describe("callModel: consent for the customer data class (fail closed)", () => {
  const nudge = { purpose: "nudger.draft", system: "s", user: JSON.stringify({ firstName: "Riya" }) };
  it("needs the customer as subject when the purpose is consent-gated", async () => {
    const { deps, fake } = makeDeps();
    expect(await callModel(nudge, deps)).toMatchObject({ kind: "blocked", reason: "consent_subject_missing" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("passes the ledger purpose and channel the registry names", async () => {
    const seen: unknown[] = [];
    const { deps } = makeDeps({ consent: async (...a) => { seen.push(a); return { allowed: true, reason: "ok" }; } });
    await callModel({ ...nudge, subject: { type: "client", id: "c1" } }, deps);
    expect(seen).toEqual([["c1", "MARKETING_COMMS", "whatsapp"]]);
  });
  it("a denial blocks and never reaches the model", async () => {
    const { deps, fake, records } = makeDeps({ consent: async () => ({ allowed: false, reason: "NO_CONSENT" }) });
    expect(await callModel({ ...nudge, subject: { type: "client", id: "c1" } }, deps)).toMatchObject({ kind: "blocked", reason: "consent_denied" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
    expect(records[0].status).toBe("blocked");
  });
  it("do-not-contact is an ABSTAIN with that reason, not an error", async () => {
    const { deps, records } = makeDeps({ consent: async () => ({ allowed: false, reason: "DO_NOT_CONTACT" }) });
    expect(await callModel({ ...nudge, subject: { type: "client", id: "c1" } }, deps)).toMatchObject({ kind: "abstain", reason: "do_not_contact" });
    expect(records[0]).toMatchObject({ status: "abstained", reasonCode: "do_not_contact" });
  });
  it("an unreadable ledger fails closed", async () => {
    const { deps, fake } = makeDeps({ consent: async () => { throw new Error("ledger down"); } });
    expect(await callModel({ ...nudge, subject: { type: "client", id: "c1" } }, deps)).toMatchObject({ kind: "blocked", reason: "consent_unavailable" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("a purpose with no customer data needs no consent check", async () => {
    const { deps } = makeDeps({ consent: async () => { throw new Error("must not be called"); } });
    expect((await callModel(ok, deps)).kind).toBe("ok");
  });
});

describe("callModel: redaction", () => {
  it("the model never sees an email, a phone number or a PAN when the purpose does not need them", async () => {
    const { deps, fake, records } = makeDeps();
    await callModel({ purpose: "social.draft", system: "s", user: "mail a@b.com, call 9876543210, pan ABCDE1234F" }, deps);
    const sent = (fake as FakeProvider).calls[0].user;
    expect(sent).not.toMatch(/a@b\.com|9876543210|ABCDE1234F/);
    expect(records[0].redactionSummary).toMatchObject({ email: 1, pan: 1, number: 1 });
  });
  it("a purpose registered for contact details keeps them, but a PAN is removed even then", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ purpose: "insight.extract", user: "call 9876543210 pan ABCDE1234F", subject: { type: "client", id: "c1" } }, deps);
    const sent = (fake as FakeProvider).calls[0].user;
    expect(sent).toContain("9876543210");
    expect(sent).not.toContain("ABCDE1234F");
  });
  it("a purpose whose facts are figures (summaries) keeps dates and amounts the model must quote, but loses emails and PANs", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ purpose: "summary.page", system: "s", user: "Next review 2026-10-12. AUM 12500000. Contact a@b.com. PAN ABCDE1234F." }, deps);
    const sent = (fake as FakeProvider).calls[0].user;
    expect(sent).toContain("2026-10-12");
    expect(sent).toContain("12500000");
    expect(sent).not.toMatch(/a@b\.com|ABCDE1234F/);
  });
  it("the compliance judge sees the drafted text as written", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ purpose: "compliance.judge", system: "s", user: "Your reference 2026-10-12-778899 is ready." }, deps);
    expect((fake as FakeProvider).calls[0].user).toContain("2026-10-12-778899");
  });
  it("strips the subject's known names when the purpose does not need names", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ purpose: "social.draft", user: "Riya Sharma wants a post", subject: { type: "client", id: "c1", knownNames: ["Riya Sharma"] } }, deps);
    expect((fake as FakeProvider).calls[0].user).toBe("[name] wants a post");
  });
  it("redacts tool results and conversation turns too", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ purpose: "ask.intelligence", system: "s", messages: [{ role: "user", content: "q a@b.com" }, { role: "user", content: [{ type: "tool_result", toolUseId: "t", content: "row a@b.com" }] }] }, deps);
    expect(JSON.stringify((fake as FakeProvider).calls[0].messages)).not.toContain("a@b.com");
  });
  it("refuses the call when the redactor let something through (belt and braces)", async () => {
    const { deps, fake } = makeDeps({ redact: (t) => ({ text: t, summary: {} }) });
    expect(await callModel({ purpose: "social.draft", user: "pan ABCDE1234F" }, deps)).toMatchObject({ kind: "blocked", reason: "redaction_failed" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
});

describe("callModel: per-purpose daily budget with a hard cap", () => {
  it("production with no budget set refuses", async () => {
    const { deps, fake } = makeDeps({ env: { NODE_ENV: "production" } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "budget_unset" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("development with no budget runs, with a warning", async () => {
    const { deps, warnings } = makeDeps({ env: {} });
    expect((await callModel(ok, deps)).kind).toBe("ok");
    expect(warnings.join(" ")).toMatch(/no daily budget/i);
  });
  it("reads a per-purpose budget, which wins over the default", async () => {
    const { deps } = makeDeps({ env: { NODE_ENV: "production", AI_PURPOSE_BUDGETS_USD: "social.draft=2", AI_BUDGET_DEFAULT_USD: "100" }, spentToday: async () => 1.99999 });
    // spent 1.99999 + worst-case estimate for this call exceeds 2
    expect(await callModel({ ...ok, maxTokens: 900 }, deps)).toMatchObject({ kind: "blocked", reason: "budget_exceeded" });
  });
  it("blocks once spend has reached the cap, even for a tiny call", async () => {
    const { deps, fake } = makeDeps({ env: { AI_PURPOSE_BUDGETS_USD: "social.draft=5" }, spentToday: async () => 5 });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "budget_exceeded" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("allows a call that fits under the cap", async () => {
    const { deps } = makeDeps({ env: { AI_PURPOSE_BUDGETS_USD: "social.draft=5" }, spentToday: async () => 1 });
    expect((await callModel(ok, deps)).kind).toBe("ok");
  });
  it("a zero budget is a hard stop", async () => {
    const { deps } = makeDeps({ env: { AI_PURPOSE_BUDGETS_USD: "social.draft=0" } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "budget_exceeded" });
  });
  it("an unreadable spend total fails closed", async () => {
    const { deps } = makeDeps({ spentToday: async () => { throw new Error("db down"); } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "blocked", reason: "budget_unavailable" });
  });
  it("asks for spend since the start of the Indian day", async () => {
    let since: Date | null = null;
    const { deps } = makeDeps({ spentToday: async (_p, d) => { since = d; return 0; } });
    await callModel(ok, deps);
    expect(since).toEqual(new Date("2026-10-11T18:30:00.000Z"));
  });
});

describe("callModel: timeout, bounded retry with backoff, typed failure", () => {
  const rate = Object.assign(new Error("slow down"), { status: 429 });
  it("retries a retryable failure, backing off, then succeeds", async () => {
    let n = 0;
    const { deps, sleeps, records } = makeDeps({ provider: new FakeProvider(() => (++n < 2 ? rate : "fine")) });
    const r = await callModel(ok, deps);
    expect(r.kind).toBe("ok");
    expect(sleeps).toEqual([400]);
    expect(records[0].attempts).toBe(2);
  });
  it("gives up after the purpose's attempt budget and returns a typed failure", async () => {
    const { deps, records, fake } = makeDeps({ provider: new FakeProvider(rate) });
    const r = await callModel(ok, deps);
    expect(r).toMatchObject({ kind: "failed", errorClass: "rate_limited", retryable: true, attempts: 2 });
    expect((fake as FakeProvider).calls).toHaveLength(2);
    expect(records[0]).toMatchObject({ status: "failed", errorClass: "rate_limited" });
  });
  it("does not retry a request the vendor rejected", async () => {
    const { deps, fake } = makeDeps({ provider: new FakeProvider(Object.assign(new Error("bad"), { status: 400 })) });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "failed", errorClass: "invalid_request", retryable: false, attempts: 1 });
    expect((fake as FakeProvider).calls).toHaveLength(1);
  });
  it("classifies server errors and network errors", async () => {
    const a = makeDeps({ provider: new FakeProvider(Object.assign(new Error("x"), { status: 503 })) });
    expect(await callModel(ok, a.deps)).toMatchObject({ errorClass: "provider_error" });
    const b = makeDeps({ provider: new FakeProvider(Object.assign(new Error("x"), { code: "ECONNRESET" })) });
    expect(await callModel(ok, b.deps)).toMatchObject({ errorClass: "network" });
  });
  it("enforces the timeout even when the provider never answers", async () => {
    const never = { name: "fake", complete: () => new Promise<never>(() => {}) };
    const { deps } = makeDeps({ provider: never });
    const r = await callModel({ ...ok, timeoutMs: 15 }, deps);
    expect(r).toMatchObject({ kind: "failed", errorClass: "timeout" });
  });
  it("hands the vendor timeout through and turns vendor-level retries off (the gateway retries itself)", async () => {
    const { deps, fake } = makeDeps();
    await callModel({ ...ok, timeoutMs: 1234 }, deps);
    expect((fake as FakeProvider).calls[0]).toMatchObject({ timeoutMs: 1234, maxRetries: 0 });
  });
  it("without a key the real provider is not called: typed not_configured", async () => {
    const { deps, fake } = makeDeps({ providerFor: () => { throw new NotConfiguredError("anthropic"); } });
    const r = await callModel(ok, deps);
    expect(r).toMatchObject({ kind: "failed", errorClass: "not_configured" });
    expect((fake as FakeProvider).calls).toHaveLength(0);
  });
  it("a key handed in by an Admin counts as configured", async () => {
    const { deps } = makeDeps({ env: { AI_BUDGET_DEFAULT_USD: "100" } });
    expect((await callModel({ ...ok, apiKey: "k" }, { ...deps, providerFor: (route) => (route.apiKey ? new FakeProvider("hi") : (() => { throw new NotConfiguredError("anthropic"); })()) })).kind).toBe("ok");
  });
  it("the demo provider is refused in production", async () => {
    const { deps } = makeDeps({ env: { NODE_ENV: "production", AI_PROVIDER: "fake", AI_BUDGET_DEFAULT_USD: "100" } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "failed", errorClass: "not_configured" });
  });
});

describe("callModel: usage, cost, trace", () => {
  it("accounts tokens and cost from the provider's usage and records one trace row without prompt or output text", async () => {
    const { deps, records } = makeDeps({ provider: new FakeProvider({ text: "SECRET OUTPUT", inputTokens: 1000, outputTokens: 500, model: "claude-sonnet-5-5" }) });
    const r = await callModel({ ...ok, user: "SECRET PROMPT", correlationId: "corr-1", causationId: "cause-1", approvalRef: "appr-1" }, deps);
    expect(r).toMatchObject({ kind: "ok", runId: "run-1", correlationId: "corr-1", usage: { inputTokens: 1000, outputTokens: 500 } });
    if (r.kind === "ok") expect(r.usage.costUsdEstimate).toBeCloseTo(0.0105, 6);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ purposeId: "social.draft", agentKey: "social_drafter", promptId: "social.draft", promptVersion: "1", inputClass: "none", status: "ok", inputTokens: 1000, outputTokens: 500, correlationId: "corr-1", causationId: "cause-1", approvalRef: "appr-1" });
    expect(records[0].promptHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(JSON.stringify(records[0])).not.toMatch(/SECRET/);
    expect(records[0].retainUntil).toEqual(new Date("2027-01-10T10:00:00Z"));
  });
  it("generates a correlation id when none is given", async () => {
    const { deps } = makeDeps();
    expect((await callModel(ok, deps)).correlationId).toBe("id-1");
  });
  it("keeps only an opaque subject reference: an email-looking id is dropped, not stored", async () => {
    const { deps, records } = makeDeps();
    await callModel({ ...ok, subject: { type: "client", id: "riya@example.com" } }, deps);
    expect(records[0]).toMatchObject({ subjectType: null, subjectId: null });
    const b = makeDeps();
    await callModel({ ...ok, subject: { type: "client", id: "cl_123" } }, b.deps);
    expect(b.records[0]).toMatchObject({ subjectType: "client", subjectId: "cl_123" });
  });
  it("retention days are configurable and default to 90", async () => {
    const { deps, records } = makeDeps({ env: { AI_BUDGET_DEFAULT_USD: "1", AI_RUN_RETENTION_DAYS: "7" } });
    await callModel(ok, deps);
    expect(records[0].retainUntil).toEqual(new Date("2026-10-19T10:00:00Z"));
  });
  it("a trace that cannot be stored never fails the call", async () => {
    const { deps } = makeDeps({ record: async () => { throw new Error("table missing"); } });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "ok", runId: null });
  });
  it("returns tool uses and stop reason from the provider", async () => {
    const { deps } = makeDeps({ provider: new FakeProvider({ toolUses: [{ id: "1", name: "t", input: { a: 1 } }], stopReason: "tool_use" }) });
    expect(await callModel({ purpose: "insight.extract", user: "x", subject: { type: "client", id: "c1" }, tools: [{ name: "t", description: "", inputSchema: {} }], toolChoice: { name: "t" } }, deps)).toMatchObject({ kind: "ok", stopReason: "tool_use", toolUses: [{ name: "t" }] });
  });
});

describe("callModel: ABSTAIN is a first-class result", () => {
  it.each([
    [{ dataAsOf: new Date("2026-10-01T00:00:00Z") }, "data_stale"],
    [{ evidenceConflict: true }, "evidence_conflict"],
    [{ doNotContact: true }, "do_not_contact"],
    [{ humanReviewRequired: true }, "human_review_required"],
  ] as const)("caller signals %j abstain %s without calling the model", async (signals, reason) => {
    const lookup = (id: string): PurposeDef | undefined => ({ ...(getPurpose(id) as PurposeDef), freshnessMs: 24 * 3600_000 });
    const { deps, fake, records } = makeDeps({ purposeLookup: lookup });
    const r = await callModel({ ...ok, signals }, deps);
    expect(r).toMatchObject({ kind: "abstain", reason });
    expect((fake as FakeProvider).calls).toHaveLength(0);
    expect(records[0]).toMatchObject({ status: "abstained", reasonCode: reason });
  });
  it("fresh data does not abstain", async () => {
    const lookup = (id: string): PurposeDef | undefined => ({ ...(getPurpose(id) as PurposeDef), freshnessMs: 24 * 3600_000 });
    const { deps } = makeDeps({ purposeLookup: lookup });
    expect((await callModel({ ...ok, signals: { dataAsOf: new Date("2026-10-12T09:00:00Z") } }, deps)).kind).toBe("ok");
  });
  it("a model reply of ABSTAIN: <reason> becomes an abstain result when the purpose uses the protocol", async () => {
    const lookup = (id: string): PurposeDef | undefined => ({ ...(getPurpose(id) as PurposeDef), abstainProtocol: true });
    const { deps, records } = makeDeps({ provider: new FakeProvider("ABSTAIN: evidence_conflict"), purposeLookup: lookup });
    expect(await callModel(ok, deps)).toMatchObject({ kind: "abstain", reason: "evidence_conflict" });
    expect(records[0].status).toBe("abstained");
    const unknown = makeDeps({ provider: new FakeProvider("ABSTAIN: because"), purposeLookup: lookup });
    expect(await callModel(ok, unknown.deps)).toMatchObject({ kind: "abstain", reason: "do_not_know" });
  });
  it("without the protocol an ABSTAIN-looking reply is just text", async () => {
    const { deps } = makeDeps({ provider: new FakeProvider("ABSTAIN: do_not_know") });
    expect((await callModel(ok, deps)).kind).toBe("ok");
  });
});

describe("callModel: evaluation hook", () => {
  it.each([
    [() => ({ pass: true }), "pass"],
    [() => ({ pass: false, note: "off-brand" }), "fail"],
    [() => { throw new Error("hook broke"); }, "error"],
  ] as const)("records the verdict (%#) and never fails the call", async (evaluate, outcome) => {
    const { deps, records } = makeDeps();
    const r = await callModel({ ...ok, evaluate }, deps);
    expect(r.kind).toBe("ok");
    expect(records[0].evalOutcome).toBe(outcome);
  });
  it("the hook sees the output, not the prompt", async () => {
    let seen: unknown;
    const { deps } = makeDeps();
    await callModel({ ...ok, user: "PROMPT", evaluate: (o) => { seen = o; return { pass: true }; } }, deps);
    expect(seen).toMatchObject({ text: "hello" });
    expect(JSON.stringify(seen)).not.toContain("PROMPT");
  });
});
