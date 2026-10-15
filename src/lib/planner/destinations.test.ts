import { describe, expect, it } from "vitest";

import { DESTINATION_KINDS, DESTINATION_STATUSES, checkDestinationPattern, isNotLiveYet } from "./destinations";

describe("destination URL pattern health check", () => {
  it("accepts an https landing page", () => {
    expect(checkDestinationPattern("WEB_LANDING", "https://example.test/tools/portfolio-check").ok).toBe(true);
  });
  it("rejects http, a missing host, credentials, spaces and braces for a landing page", () => {
    for (const p of ["http://example.test/x", "https:///x", "https://u:p@example.test/x", "https://exa mple.test/x", "https://example.test/{id}", "example.test/x", ""]) {
      expect(checkDestinationPattern("WEB_LANDING", p).ok, p).toBe(false);
    }
  });
  it("accepts an app deep link with a custom scheme or a universal link, and rejects dangerous schemes", () => {
    expect(checkDestinationPattern("APP_DEEP_LINK", "exampleapp://goal-planner/retirement").ok).toBe(true);
    expect(checkDestinationPattern("APP_DEEP_LINK", "https://example.test/app/goal-planner").ok).toBe(true);
    for (const p of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "exampleapp://", "exampleapp"]) {
      expect(checkDestinationPattern("APP_DEEP_LINK", p).ok, p).toBe(false);
    }
  });
  it("accepts a WhatsApp click-to-chat with a plausible number and rejects anything else", () => {
    expect(checkDestinationPattern("WHATSAPP_CHAT", "https://wa.me/919800000001").ok).toBe(true);
    expect(checkDestinationPattern("WHATSAPP_CHAT", "https://api.whatsapp.com/send?phone=919800000001").ok).toBe(true);
    for (const p of ["https://wa.me/12", "https://wa.me/abc", "https://example.test/919800000001", "http://wa.me/919800000001"]) {
      expect(checkDestinationPattern("WHATSAPP_CHAT", p).ok, p).toBe(false);
    }
  });
  it("rejects an unknown kind", () => {
    expect(checkDestinationPattern("FAX", "https://example.test").ok).toBe(false);
  });
  it("says what is wrong", () => {
    expect(checkDestinationPattern("WEB_LANDING", "http://example.test").message).toMatch(/https/);
  });
});

describe("status", () => {
  it("lists the kinds and statuses", () => {
    expect(DESTINATION_KINDS).toEqual(["APP_DEEP_LINK", "WEB_LANDING", "WHATSAPP_CHAT"]);
    expect(DESTINATION_STATUSES).toEqual(["LIVE", "PLANNED", "OFF"]);
  });
  it("flags planned and off destinations as not live yet", () => {
    expect(isNotLiveYet("PLANNED")).toBe(true);
    expect(isNotLiveYet("OFF")).toBe(true);
    expect(isNotLiveYet("LIVE")).toBe(false);
  });
});
