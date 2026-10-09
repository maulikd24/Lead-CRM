import { describe, expect, it } from "vitest";
import { SERVICE_WINDOW_MS, isWithinServiceWindow, templateRequired, usesServiceWindow } from "./service-window";

const now = new Date("2026-10-09T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3600_000;

describe("isWithinServiceWindow", () => {
  it("is open for 24 hours after the customer's last message", () => {
    expect(isWithinServiceWindow(ago(HOUR), now)).toBe(true);
    expect(isWithinServiceWindow(ago(24 * HOUR - 1), now)).toBe(true);
  });
  it("is closed at exactly 24 hours and after", () => {
    expect(SERVICE_WINDOW_MS).toBe(24 * HOUR);
    expect(isWithinServiceWindow(ago(24 * HOUR), now)).toBe(false);
    expect(isWithinServiceWindow(ago(30 * HOUR), now)).toBe(false);
  });
  it("is closed when the customer never wrote", () => {
    expect(isWithinServiceWindow(null, now)).toBe(false);
    expect(isWithinServiceWindow(undefined, now)).toBe(false);
  });
  it("treats a slightly future timestamp (clock skew) as inside the window", () => {
    expect(isWithinServiceWindow(new Date(now.getTime() + 5000), now)).toBe(true);
  });
});

describe("templateRequired", () => {
  it("applies only to the Meta Cloud API provider", () => {
    expect(usesServiceWindow({ provider: "whatsapp_meta" })).toBe(true);
    expect(usesServiceWindow({ provider: "whatsapp_openwa" })).toBe(false);
    expect(usesServiceWindow({})).toBe(false);
  });
  it("requires a template on Meta outside the window", () => {
    expect(templateRequired({ provider: "whatsapp_meta" }, ago(25 * HOUR), now)).toBe(true);
    expect(templateRequired({ provider: "whatsapp_meta" }, null, now)).toBe(true);
  });
  it("does not require one on Meta inside the window", () => {
    expect(templateRequired({ provider: "whatsapp_meta" }, ago(HOUR), now)).toBe(false);
  });
  it("never requires one for WhatsApp-Web style accounts", () => {
    expect(templateRequired({ provider: "whatsapp_openwa" }, ago(100 * HOUR), now)).toBe(false);
    expect(templateRequired({ provider: null }, null, now)).toBe(false);
  });
});
