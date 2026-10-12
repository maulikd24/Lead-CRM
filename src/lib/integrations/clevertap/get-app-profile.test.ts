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
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });

  it("no email and no mobile => not found, no call", async () => {
    const d = deps();
    expect(await getAppProfile({ email: " ", mobile: null }, d)).toEqual({ found: false });
    expect(calls(d)).toBe(0);
  });

  it("first attempt is identity=<pickIdentity>: the raw email, url-encoded, GET with both headers and a signal", async () => {
    const d = deps();
    const r = await getAppProfile({ email: "jack+vip@gmail.com", mobile: "9876543210" }, d);
    expect(r).toMatchObject({ found: true, platforms: ["iOS", "Web"] });
    expect(calls(d)).toBe(1);
    expect(urlOf(d)).toBe("https://in1.api.clevertap.com/1/profile.json?identity=jack%2Bvip%40gmail.com");
    const init = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toEqual({ "X-CleverTap-Account-Id": "acc-1", "X-CleverTap-Passcode": "pass-1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads are allowed in any region (eu1 and blank)", async () => {
    const eu = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { ...creds, region: "eu1" } }) });
    await getAppProfile({ email: "a@b.com", mobile: null }, eu);
    expect(urlOf(eu)).toMatch(/^https:\/\/eu1\.api\.clevertap\.com\//);
    const blank = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { accountId: "a", passcode: "p" } }) });
    await getAppProfile({ email: "a@b.com", mobile: null }, blank);
    expect(urlOf(blank)).toMatch(/^https:\/\/api\.clevertap\.com\//);
  });

  it("mobile-only: raw mobile identity first, then the +91 form", async () => {
    const d = deps({}, { status: "success", record: null });
    expect(await getAppProfile({ email: null, mobile: "98765 43210" }, d)).toEqual({ found: false });
    expect(urls(d)).toEqual([
      "https://in1.api.clevertap.com/1/profile.json?identity=98765%2043210",
      "https://in1.api.clevertap.com/1/profile.json?identity=%2B919876543210",
    ]);
  });
  it("email only: identity=email, then email=email", async () => {
    const d = deps({}, { status: "success", record: null });
    await getAppProfile({ email: "a@b.com", mobile: null }, d);
    expect(urls(d)).toEqual([
      "https://in1.api.clevertap.com/1/profile.json?identity=a%40b.com",
      "https://in1.api.clevertap.com/1/profile.json?email=a%40b.com",
    ]);
  });
  it("email + mobile: identity=email, email=email, identity=+91 mobile", async () => {
    const d = deps({}, { status: "success", record: null });
    expect(await getAppProfile({ email: "a@b.com", mobile: "9876543210" }, d)).toEqual({ found: false });
    expect(urls(d)).toEqual([
      "https://in1.api.clevertap.com/1/profile.json?identity=a%40b.com",
      "https://in1.api.clevertap.com/1/profile.json?email=a%40b.com",
      "https://in1.api.clevertap.com/1/profile.json?identity=%2B919876543210",
    ]);
  });
  it("stops at the first record found (no extra calls)", async () => {
    const seq = [{ status: "success", record: null }, sample];
    const fetch = vi.fn(async () => new Response(JSON.stringify(seq.shift()), { status: 200 })) as unknown as typeof globalThis.fetch;
    const d = deps({ fetch });
    expect(await getAppProfile({ email: "a@b.com", mobile: "9876543210" }, d)).toMatchObject({ found: true });
    expect(calls(d)).toBe(2);
  });
  it("dedupes identical attempts (already-+91 mobile; fail status counts as no record)", async () => {
    const d = deps({}, { status: "fail", error: "x" });
    await getAppProfile({ email: null, mobile: "+919876543210" }, d);
    expect(calls(d)).toBe(1);
  });
  it("an error on any attempt stops the chain", async () => {
    const seq = [new Response(JSON.stringify({ status: "success", record: null }), { status: 200 }), new Response("{}", { status: 429 })];
    const fetch = vi.fn(async () => seq.shift() as Response) as unknown as typeof globalThis.fetch;
    const d = deps({ fetch });
    expect(await getAppProfile({ email: "a@b.com", mobile: "9876543210" }, d)).toEqual({ error: "CleverTap responded 429", kind: "busy" });
    expect(calls(d)).toBe(2);
  });
  it("all attempts share one signal (one time budget)", async () => {
    const d = deps({}, { status: "success", record: null });
    await getAppProfile({ email: "a@b.com", mobile: "9876543210" }, d);
    const sigs = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1].signal);
    expect(new Set(sigs).size).toBe(1);
  });
  it.each([
    [400, "rejected"], [401, "rejected"], [403, "rejected"], [429, "busy"], [500, "unreachable"], [503, "unreachable"],
  ])("status %i => kind %s", async (status, kind) => {
    const r = await getAppProfile({ email: "a@b.com", mobile: null }, deps({}, {}, status));
    expect(r).toEqual({ error: `CleverTap responded ${status}`, kind });
  });
  it.each([["+919876543210", "%2B919876543210"], ["919876543210", "%2B919876543210"], ["09876543210", "%2B919876543210"], ["+14155550123", "%2B14155550123"]])("normalises mobile %s for the fallback", async (mobile, enc) => {
    const d = deps({}, { status: "success", record: null });
    await getAppProfile({ email: null, mobile }, d);
    expect(urls(d).at(-1)).toContain(`identity=${enc}`);
  });
  it("unusable mobile (no digits) still tries its raw identity only", async () => {
    const d = deps({}, { status: "success", record: null });
    expect(await getAppProfile({ email: null, mobile: "n/a" }, d)).toEqual({ found: false });
    expect(calls(d)).toBe(1);
  });

  it("maps 200 with null record or fail status to not found", async () => {
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, deps({}, { status: "success", record: null }))).toEqual({ found: false });
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, deps({}, { status: "fail", error: "x" }))).toEqual({ found: false });
  });

  it("maps non-2xx to a status-only error and never echoes the body", async () => {
    const r = await getAppProfile({ email: "a@b.com", mobile: null }, deps({}, { status: "fail", error: "secret detail pass-1" }, 401));
    expect(r).toEqual({ error: "CleverTap responded 401", kind: "rejected" });
  });

  it("maps a thrown fetch, timeout, or bad JSON to unreachable", async () => {
    const boom = deps({ fetch: (async () => { throw new Error("ECONNRESET acc-1"); }) as unknown as typeof fetch });
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, boom)).toEqual({ error: "CleverTap is unreachable", kind: "unreachable" });
    const badJson = deps({ fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, badJson)).toEqual({ error: "CleverTap is unreachable", kind: "unreachable" });
  });

  it("a config loader failure is reported as not connected without throwing", async () => {
    const d = deps({ loadConfig: async () => { throw new Error("db down"); } });
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });

  it("an invalid region is not connected rather than a crash", async () => {
    const d = deps({ loadConfig: async () => ({ mode: "live", isEnabled: true, credentials: { ...creds, region: "evil.com/x" } }) });
    expect(await getAppProfile({ email: "a@b.com", mobile: null }, d)).toEqual({ error: "CleverTap is not connected", kind: "not_connected" });
    expect(calls(d)).toBe(0);
  });
});
