import { describe, expect, it, vi } from "vitest";

import { jobSpec } from "./job-registry";
import type { RunRow, RunStore } from "./job-run";
import { classifyResponse, createWithRunRecord } from "./webhook-run";

function setup(opts: { schedule?: (fn: () => Promise<void>) => void } = {}) {
  const rows: RunRow[] = [];
  const store: RunStore = { insert: async () => {}, update: async () => {}, createMany: async (b) => { rows.push(...b); } };
  const pending: Promise<void>[] = [];
  const schedule = opts.schedule ?? ((fn: () => Promise<void>) => { pending.push(fn()); });
  const withRunRecord = createWithRunRecord({ store, schedule, now: () => new Date(5_000), newId: () => "rid", env: { VERCEL_GIT_COMMIT_SHA: "abcdef1234567" } });
  return { rows, withRunRecord, settle: () => Promise.all(pending) };
}
const spec = jobSpec("webhook:meta-leads")!;
const req = () => new Request("https://x.test/api/webhooks/meta-leads", { method: "POST", body: "SECRET-BODY", headers: { authorization: "Bearer topsecret" } });

describe("classifyResponse", () => {
  it.each([[200, "OK"], [202, "OK"], [401, "REJECTED"], [403, "REJECTED"], [400, "OK"], [404, "OK"], [422, "OK"], [500, "FAILED"], [503, "FAILED"]])("%i -> %s", (status, expected) => {
    expect(classifyResponse(status).status).toBe(expected);
  });
  it("keeps the http status as a count for a client error", () => expect(classifyResponse(422).summary).toEqual({ httpStatus: 422 }));
});

describe("withRunRecord", () => {
  it("returns the handler's own response untouched and records OK after the fact", async () => {
    const { rows, withRunRecord, settle } = setup();
    const res = new Response("ok", { status: 200 });
    const wrapped = withRunRecord(spec, async () => res);
    expect(await wrapped(req())).toBe(res);
    await settle();
    expect(rows[0]).toMatchObject({ job: "webhook:meta-leads", kind: "WEBHOOK", status: "OK", deployRef: "abcdef1" });
  });
  it("records a signature failure as REJECTED and stores no body or header", async () => {
    const { rows, withRunRecord, settle } = setup();
    await withRunRecord(spec, async () => new Response("no", { status: 401 }))(req());
    await settle();
    expect(rows[0].status).toBe("REJECTED");
    expect(JSON.stringify(rows[0])).not.toMatch(/SECRET-BODY|topsecret/);
  });
  it("records a throw as FAILED and rethrows the original error", async () => {
    const { rows, withRunRecord, settle } = setup();
    const boom = new RangeError("kaboom");
    await expect(withRunRecord(spec, async () => { throw boom; })(req())).rejects.toBe(boom);
    await settle();
    expect(rows[0]).toMatchObject({ status: "FAILED", errorClass: "RangeError" });
  });
  it("records a 500 response as FAILED", async () => {
    const { rows, withRunRecord, settle } = setup();
    await withRunRecord(spec, async () => new Response("err", { status: 500 }))(req());
    await settle();
    expect(rows[0]).toMatchObject({ status: "FAILED", errorClass: "Http500" });
  });
  it("never reads the request body (signature verification keeps working)", async () => {
    const { withRunRecord, settle } = setup();
    const r = req();
    await withRunRecord(spec, async (request) => new Response(await request.text(), { status: 200 }))(r);
    await settle();
    expect(r.bodyUsed).toBe(true); // consumed by the handler, once, not by the wrapper
  });
  it("does not wait for the store before returning", async () => {
    const { withRunRecord } = setup({ schedule: () => { /* never runs */ } });
    const res = await withRunRecord(spec, async () => new Response("ok"))(req());
    expect(res.status).toBe(200);
  });
  it("passes extra arguments (route params) through", async () => {
    const { withRunRecord } = setup();
    const handler = vi.fn(async (_r: Request, ctx: { params: Promise<{ id: string }> }) => new Response(String((await ctx.params).id)));
    const res = await withRunRecord(spec, handler)(req(), { params: Promise.resolve({ id: "7" }) });
    expect(await res.text()).toBe("7");
  });
  it("a store that throws never changes the response", async () => {
    const store: RunStore = { insert: async () => { throw new Error("x"); }, update: async () => {}, createMany: async () => { throw new Error("db down"); } };
    const pending: Promise<void>[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = createWithRunRecord({ store, schedule: (fn) => { pending.push(fn()); }, env: {} });
    const res = await w(spec, async () => new Response("fine", { status: 200 }))(req());
    await Promise.all(pending);
    spy.mockRestore();
    expect(await res.text()).toBe("fine");
  });
  it("can skip recording successful polls and still record failures", async () => {
    const { rows, withRunRecord, settle } = setup();
    const poll = withRunRecord(spec, async () => new Response("[]"), { recordOk: false });
    await poll(req());
    const bad = withRunRecord(spec, async () => new Response("x", { status: 500 }), { recordOk: false });
    await bad(req());
    await settle();
    expect(rows.map((r) => r.status)).toEqual(["FAILED"]);
  });
});
