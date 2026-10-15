import { describe, expect, it } from "vitest";

import { appendParams, buildTrackedLinks, buildWhatsAppLink, defaultWhatsAppMessage, validateLink } from "./links";

const CODE = "CP-7K3Q9X";

describe("appendParams", () => {
  it("keeps existing query and fragment and adds the new parameters", () => {
    expect(appendParams("https://example.test/plan?lang=hi#top", { utm_source: "google", campaign_code: CODE })).toBe("https://example.test/plan?lang=hi&utm_source=google&campaign_code=CP-7K3Q9X#top");
  });
  it("overwrites a parameter that is already there instead of repeating it", () => {
    expect(appendParams("https://example.test/p?utm_source=old", { utm_source: "new" })).toBe("https://example.test/p?utm_source=new");
  });
  it("preserves the campaign code on an app deep link", () => {
    const out = appendParams("exampleapp://goal-planner/retirement?step=2", { campaign_code: CODE, utm_source: "meta" });
    expect(out.startsWith("exampleapp://goal-planner/retirement?")).toBe(true);
    expect(new URL(out).searchParams.get("campaign_code")).toBe(CODE);
    expect(new URL(out).searchParams.get("step")).toBe("2");
  });
});

describe("click-to-WhatsApp link", () => {
  it("prefills a message that carries the campaign code", () => {
    const link = buildWhatsAppLink("https://wa.me/919800000001", { code: CODE, hook: "Check your mutual fund portfolio in a minute" });
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe("https://wa.me/919800000001");
    expect(url.searchParams.get("text")).toContain(CODE);
    expect(link.message).toContain(CODE);
  });
  it("accepts the api.whatsapp.com form", () => {
    expect(buildWhatsAppLink("https://api.whatsapp.com/send?phone=919800000001", { code: CODE, hook: "x" }).ok).toBe(true);
  });
  it("refuses a destination that is not a WhatsApp chat", () => {
    expect(buildWhatsAppLink("https://example.test/chat", { code: CODE, hook: "x" }).ok).toBe(false);
  });
  it("keeps the prefilled message short and free of personal details", () => {
    const msg = defaultWhatsAppMessage({ code: CODE, hook: "a".repeat(400) });
    expect(msg.length).toBeLessThanOrEqual(200);
    expect(msg).toContain(CODE);
  });
});

describe("validateLink", () => {
  it("rejects a link with an email, phone number or PAN in it", () => {
    expect(validateLink("https://example.test/p?email=asha%40example.com").ok).toBe(false);
    expect(validateLink("https://example.test/p?ref=9876543210").ok).toBe(false);
    expect(validateLink("https://example.test/p/ABCDE1234F").ok).toBe(false);
  });
  it("rejects credentials in the URL and non-https web links", () => {
    expect(validateLink("https://user:pw@example.test/p").ok).toBe(false);
    expect(validateLink("http://example.test/p").ok).toBe(false);
    expect(validateLink("javascript:alert(1)").ok).toBe(false);
  });
  it("accepts a clean link", () => {
    expect(validateLink("https://example.test/p?utm_source=google&campaign_code=CP-7K3Q9X")).toEqual({ ok: true, problems: [] });
  });
});

describe("buildTrackedLinks", () => {
  const base = { code: CODE, channel: "search_ad" as const, audienceName: "Salaried professionals", hook: "See if you are on track for retirement", startDate: "2026-10-01" };
  it("returns a tagged link for a web destination, valid and carrying the code", () => {
    const r = buildTrackedLinks({ ...base, destination: { kind: "WEB_LANDING", urlPattern: "https://example.test/retirement-check" }, content: "v1", term: "retirement_calculator" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.links.map((l) => l.kind)).toEqual(["tagged"]);
    const u = new URL(r.links[0].url);
    expect(u.searchParams.get("utm_source")).toBe("google");
    expect(u.searchParams.get("utm_medium")).toBe("cpc");
    expect(u.searchParams.get("campaign_code")).toBe(CODE);
    expect(u.searchParams.get("utm_term")).toBe("retirement_calculator");
    expect(r.links[0].validation.ok).toBe(true);
  });
  it("returns the prefilled WhatsApp link for a WhatsApp destination", () => {
    const r = buildTrackedLinks({ ...base, channel: "click_to_whatsapp", destination: { kind: "WHATSAPP_CHAT", urlPattern: "https://wa.me/919800000001" } });
    expect(r.ok && r.links.map((l) => l.kind)).toEqual(["whatsapp"]);
  });
  it("keeps the code on an app deep link and also gives the web fallback shape", () => {
    const r = buildTrackedLinks({ ...base, channel: "email", destination: { kind: "APP_DEEP_LINK", urlPattern: "exampleapp://goal-planner/retirement" } });
    expect(r.ok && new URL(r.links[0].url).searchParams.get("campaign_code")).toBe(CODE);
  });
  it("fails with the reason when the destination pattern is invalid", () => {
    const r = buildTrackedLinks({ ...base, destination: { kind: "WEB_LANDING", urlPattern: "not a url" } });
    expect(r.ok).toBe(false);
  });
});
