import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The share-link page is the one unauthenticated surface of the report module. Its controls are pinned here at the page, with the database and
 * the rate limiter replaced: flag off, a malformed token, a rate-limited address, an unknown or pending link and an expired or revoked one all
 * leak nothing; an open link renders the stored snapshot and never reads a customer table.
 */
const state = vi.hoisted(() => ({ flag: true, allowed: true, share: { state: "not_found" } as unknown, ip: "203.0.113.7", rateCalls: [] as unknown[][], openCalls: [] as unknown[] }));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${state.ip}, 10.0.0.1` }) }));
vi.mock("@/lib/creative/flags", () => ({ directorReportsEnabled: () => state.flag }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimit: async (...a: unknown[]) => { state.rateCalls.push(a); return { allowed: state.allowed }; } }));
vi.mock("@/lib/director/db", () => ({ openShare: async (t: unknown) => { state.openCalls.push(t); return state.share; } }));
vi.mock("@/components/creative/report-document", () => ({ ReportDocument: () => null }));

import Page, { metadata } from "./page";

const TOKEN = "A".repeat(43);
const render = async (token = TOKEN) => Page({ params: Promise.resolve({ token }) });
const text = (el: unknown): string => JSON.stringify(el);

beforeEach(() => { state.flag = true; state.allowed = true; state.share = { state: "not_found" }; state.rateCalls = []; state.openCalls = []; });

describe("share link page", () => {
  it("is never indexed and sends no referrer (the address carries the key)", () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false }, referrer: "no-referrer" });
  });
  it("is a plain 404 while the feature is off, before anything is read", async () => {
    state.flag = false;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.rateCalls).toEqual([]);
    expect(state.openCalls).toEqual([]);
  });
  it("is a plain 404 for a malformed token, before the limiter or the database is touched", async () => {
    for (const bad of ["", "short", "../../etc/passwd", "A".repeat(44), "A".repeat(42) + "!"]) await expect(render(bad)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.rateCalls).toEqual([]);
    expect(state.openCalls).toEqual([]);
  });
  it("rate limits per address (the first hop of x-forwarded-for) and says so without opening the link", async () => {
    state.allowed = false;
    const el = await render();
    expect(text(el)).toMatch(/Too many requests/);
    expect(state.rateCalls[0]).toEqual(["report-share", "203.0.113.7", { limit: 60, windowSeconds: 600 }]);
    expect(state.openCalls).toEqual([]);
  });
  it("an unknown token and a link still awaiting approval are the same plain 404", async () => {
    state.share = { state: "not_found" };
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("an expired and a revoked link each say so in one neutral line and show nothing of the report", async () => {
    state.share = { state: "expired" };
    expect(text(await render())).toMatch(/This link has expired/);
    state.share = { state: "revoked" };
    const revoked = text(await render());
    expect(revoked).toMatch(/This link has been withdrawn/);
    expect(revoked).not.toMatch(/ReportDocument|funded/i);
  });
  it("an open link renders the stored report with its expiry and nothing else", async () => {
    state.share = { state: "open", report: { period: { from: "2027-06-29", to: "2027-07-05" } }, expiresAt: new Date("2027-07-12T09:00:00Z") };
    const el = (await render()) as { props: { shared: boolean; expiresAt: string; report: unknown } };
    expect(el.props).toMatchObject({ shared: true, expiresAt: "2027-07-12T09:00:00.000Z" });
    expect(state.openCalls).toEqual([TOKEN]);
  });
});
