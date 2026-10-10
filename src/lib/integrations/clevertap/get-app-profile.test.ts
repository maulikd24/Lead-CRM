import { describe, expect, it, vi } from "vitest";
import sample from "./__fixtures__/profile.sample.json";
import { getAppProfile, type AppProfileDeps } from "./get-app-profile";

const creds = { accountId: "acc-1", passcode: "pass-1", region: "in1" };
function deps(over: Partial<AppProfileDeps> = {}, body: unknown = sample, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;
  const d: AppProfileDeps = { loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: creds }), fetch, ...over };
  return d;
}
const urlOf = (d: AppProfileDeps) => String((d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
const urls = (d: AppProfileDeps) => (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const calls = (d: AppProfileDeps) => (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

describe("getAppProfile", () => {
  it.each([
    ["no config", async () => null],
    ["disabled", async () => ({ mode: "live", isEnabled: false, credentials: creds })],
    ["mock mode", async () => ({ mode: "mock", isEnabled: true, credentials: creds })],
    ["dry_run mode", async () => ({ mode: "dry_run", isEnabled: true, credentials: creds })],
    ["no credentials", async () => ({ mode: "live", isEnabled: true, credentials: null })],
    ["blank passcode", async () => ({ mode: "live", isEnabled: true, credentials: { ...creds, passcode: "" } })],
  ])("%s => not connected, no network call", async (_n, loadConfig) => {
    const d = deps({ loadConfig });
    expect(await getAppProfile({ appUserId: "u1" }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });

  it("no app user id => not found, no call (email and mobile are never used as a key)", async () => {
    const d = deps();
    expect(await getAppProfile({ appUserId: null }, d)).toEqual({ found: false });
    expect(await getAppProfile({ appUserId: "  " }, d)).toEqual({ found: false });
    expect(calls(d)).toBe(0);
  });

  it("looks up identity=<app user id> only: one GET with both headers and a signal", async () => {
    const d = deps();
    const r = await getAppProfile({ appUserId: "sub/1+x" }, d);
    expect(r).toMatchObject({ found: true, platforms: ["iOS", "Web"] });
    expect(calls(d)).toBe(1);
    expect(urlOf(d)).toBe("https://in1.api.clevertap.com/1/profile.json?identity=sub%2F1%2Bx");
    const init = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toEqual({ "X-CleverTap-Account-Id": "acc-1", "X-CleverTap-Passcode": "pass-1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads are allowed in any region (eu1 and blank)", async () => {
    const eu = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { ...creds, region: "eu1" } }) });
    await getAppProfile({ appUserId: "u1" }, eu);
    expect(urlOf(eu)).toMatch(/^https:\/\/eu1\.api\.clevertap\.com\//);
    const blank = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { accountId: "a", passcode: "p" } }) });
    await getAppProfile({ appUserId: "u1" }, blank);
    expect(urlOf(blank)).toMatch(/^https:\/\/api\.clevertap\.com\//);
  });
  it("a profile that does not exist is not found after a single call", async () => {
    const d = deps({}, { status: "success", record: null });
    expect(await getAppProfile({ appUserId: "u1" }, d)).toEqual({ found: false });
    expect(calls(d)).toBe(1);
  });

  it.each([
    [400, "rejected"], [401, "rejected"], [403, "rejected"], [429, "busy"], [500, "unreachable"], [503, "unreachable"],
  ])("status %i => kind %s", async (status, kind) => {
    const r = await getAppProfile({ appUserId: "u1" }, deps({}, {}, status));
    expect(r).toEqual({ error: `CleverTap responded ${status}`, kind });
  });
  it("maps 200 with null record or fail status to not found", async () => {
    expect(await getAppProfile({ appUserId: "u1" }, deps({}, { status: "success", record: null }))).toEqual({ found: false });
    expect(await getAppProfile({ appUserId: "u1" }, deps({}, { status: "fail", error: "x" }))).toEqual({ found: false });
  });

  it("maps non-2xx to a status-only error and never echoes the body", async () => {
    const r = await getAppProfile({ appUserId: "u1" }, deps({}, { status: "fail", error: "secret detail pass-1" }, 401));
    expect(r).toEqual({ error: "CleverTap responded 401", kind: "rejected" });
  });

  it("maps a thrown fetch, timeout, or bad JSON to unreachable", async () => {
    const boom = deps({ fetch: (async () => { throw new Error("ECONNRESET acc-1"); }) as unknown as typeof fetch });
    expect(await getAppProfile({ appUserId: "u1" }, boom)).toEqual({ error: "CleverTap is unreachable", kind: "unreachable" });
    const badJson = deps({ fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    expect(await getAppProfile({ appUserId: "u1" }, badJson)).toEqual({ error: "CleverTap is unreachable", kind: "unreachable" });
  });

  it("a config loader failure is reported as not connected without throwing", async () => {
    const d = deps({ loadConfig: async () => { throw new Error("db down"); } });
    expect(await getAppProfile({ appUserId: "u1" }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });

  it("an invalid region is not connected rather than a crash", async () => {
    const d = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { ...creds, region: "evil.com/x" } }) });
    expect(await getAppProfile({ appUserId: "u1" }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });
});
