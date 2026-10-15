import { describe, expect, it } from "vitest";

import { decideHealth, isProbeable, probeDestination, type ProbeFetch } from "./health";

describe("which destinations are probed (and which never are)", () => {
  it("probes public https landing pages and https universal links only", () => {
    expect(isProbeable("WEB_LANDING", "https://www.example.test/retirement")).toBe(true);
    expect(isProbeable("APP_DEEP_LINK", "https://app.example.test/goal")).toBe(true);
  });
  it("never probes a custom app scheme, WhatsApp, plain http, an IP address or an internal host", () => {
    for (const [kind, url] of [["APP_DEEP_LINK", "exampleapp://goal-planner"], ["WHATSAPP_CHAT", "https://wa.me/919876543210"], ["WEB_LANDING", "http://www.example.test"], ["WEB_LANDING", "https://127.0.0.1/x"], ["WEB_LANDING", "https://10.0.0.5/x"], ["WEB_LANDING", "https://[::1]/x"], ["WEB_LANDING", "https://localhost/x"], ["WEB_LANDING", "https://db.internal/x"], ["WEB_LANDING", "https://printer.local/x"], ["WEB_LANDING", "https://example.test:8443/x"], ["WEB_LANDING", "https://user:pw@example.test/x"]] as const) {
      expect(isProbeable(kind, url), `${kind} ${url}`).toBe(false);
    }
  });
});

describe("probeDestination", () => {
  const fetching = (res: { status: number } | Error): ProbeFetch => async () => { if (res instanceof Error) throw res; return res; };
  it("a 2xx or a redirect is reachable; the redirect is not followed", async () => {
    expect(await probeDestination("https://www.example.test/a", fetching({ status: 200 }))).toEqual({ reachable: true, message: "Answered HTTP 200." });
    expect((await probeDestination("https://www.example.test/a", fetching({ status: 301 }))).reachable).toBe(true);
  });
  it("a 404, a 500, a timeout and a network error are not reachable, each with its own words", async () => {
    expect(await probeDestination("https://www.example.test/a", fetching({ status: 404 }))).toEqual({ reachable: false, message: "The page answered HTTP 404." });
    expect((await probeDestination("https://www.example.test/a", fetching({ status: 503 }))).reachable).toBe(false);
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(await probeDestination("https://www.example.test/a", fetching(abort))).toEqual({ reachable: false, message: "The page did not answer within 5 seconds." });
    expect((await probeDestination("https://www.example.test/a", fetching(new Error("ENOTFOUND")))).message).toMatch(/could not be reached/);
  });
  it("sends a HEAD request without credentials, without following redirects, with a timeout signal", async () => {
    let seen: RequestInit | undefined;
    await probeDestination("https://www.example.test/a", async (_u, init) => { seen = init; return { status: 200 }; });
    expect(seen).toMatchObject({ method: "HEAD", redirect: "manual", credentials: "omit" });
    expect(seen?.signal).toBeDefined();
  });
  it("refuses to probe something that is not probeable", async () => {
    let called = false;
    const r = await probeDestination("http://127.0.0.1/x", async () => { called = true; return { status: 200 }; });
    expect(called).toBe(false);
    expect(r.reachable).toBe(false);
  });
});

describe("decideHealth combines the pattern check and the probe", () => {
  it("a bad pattern is unhealthy whatever the probe says", () => {
    expect(decideHealth({ ok: false, message: "A landing page must use https." }, null)).toEqual({ ok: false, message: "A landing page must use https." });
  });
  it("a good pattern with no probe stays healthy and says it was not called", () => {
    expect(decideHealth({ ok: true, message: "The URL pattern is valid." }, null)).toEqual({ ok: true, message: "The URL pattern is valid. Not called (only web pages are)." });
  });
  it("a good pattern with an unreachable page is unhealthy", () => {
    expect(decideHealth({ ok: true, message: "The URL pattern is valid." }, { reachable: false, message: "The page answered HTTP 404." })).toEqual({ ok: false, message: "The page answered HTTP 404." });
    expect(decideHealth({ ok: true, message: "The URL pattern is valid." }, { reachable: true, message: "Answered HTTP 200." })).toEqual({ ok: true, message: "Answered HTTP 200." });
  });
});
