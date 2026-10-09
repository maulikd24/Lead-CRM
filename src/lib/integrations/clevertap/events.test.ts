import { describe, expect, it } from "vitest";
import { labelFor, normalizeCleverTapEvent } from "./events";

describe("normalizeCleverTapEvent", () => {
  it("routes an email identity to clientEmail and a phone identity to clientPhone", () => {
    const e = normalizeCleverTapEvent({ identity: "riya@example.com", evtName: "KYC Completed", evtData: { step: "ckyc" } });
    expect(e[0]).toMatchObject({ type: "campaign_event", clientEmail: "riya@example.com" });
    const p = normalizeCleverTapEvent({ identity: "+91 98765 43210", evtName: "App Installed" });
    expect(p[0]).toMatchObject({ clientPhone: "+91 98765 43210" });
  });
  it("falls back to email or phone inside evtData when the identity is an opaque id", () => {
    const e = normalizeCleverTapEvent({ identity: "3f9c2a7e-aaaa-bbbb-cccc-1234567890ab", evtName: "Signup", evtData: { Email: "riya@example.com", Phone: "9876543210" } });
    expect(e[0]).toMatchObject({ clientEmail: "riya@example.com", clientPhone: "9876543210" });
  });
  it("passes a formatted phone in evtData through unchanged", () => {
    const e = normalizeCleverTapEvent({ identity: "opaque-id-1", evtName: "Signup", evtData: { Phone: "+91 98765 43210" } });
    expect(e[0].clientPhone).toBe("+91 98765 43210");
  });
  it("returns no event when nothing identifies a contact (the route could not match it)", () => {
    expect(normalizeCleverTapEvent({ identity: "3f9c2a7e-aaaa-bbbb-cccc-1234567890ab", evtName: "Signup", evtData: { plan: "gold" } })).toEqual([]);
    expect(normalizeCleverTapEvent({ evtName: "Signup", evtData: {} })).toEqual([]);
  });
  it("never stores an opaque identity in the payload", () => {
    const id = "3f9c2a7e-aaaa-bbbb-cccc-1234567890ab";
    const e = normalizeCleverTapEvent({ identity: id, evtName: "Signup", evtData: { Email: "riya@example.com" } });
    expect(JSON.stringify(e[0].payload)).not.toContain(id);
  });
  it("keeps a readable label and the raw event name", () => {
    const e = normalizeCleverTapEvent({ identity: "a@b.com", evtName: "kyc_completed", evtData: {} });
    expect(e[0].payload).toMatchObject({ eventName: "kyc_completed", message: "App event: KYC completed" });
  });
  it("ignores malformed payloads without throwing", () => {
    for (const bad of [null, undefined, "x", 5, [], {}, { evtName: 3 }, { identity: {}, evtName: "x" }]) {
      expect(() => normalizeCleverTapEvent(bad)).not.toThrow();
      expect(normalizeCleverTapEvent(bad)).toEqual([]);
    }
  });
  it("drops oversized event data instead of storing it", () => {
    const big = { identity: "a@b.com", evtName: "X", evtData: { blob: "z".repeat(10_000) } };
    const e = normalizeCleverTapEvent(big);
    expect(JSON.stringify(e[0].payload).length).toBeLessThan(2_000);
  });
  it("caps the total size of stored props, not just each value", () => {
    const allowed = ["campaign", "campaign_name", "campaign_id", "channel", "platform", "source", "step", "status", "screen", "product", "category"];
    const evtData = Object.fromEntries(allowed.map((k) => [k, "y".repeat(300)]));
    const e = normalizeCleverTapEvent({ identity: "a@b.com", evtName: "X", evtData });
    const props = (e[0].payload as { props: Record<string, unknown> }).props;
    expect(JSON.stringify(props).length).toBeLessThanOrEqual(1_500);
    expect(Object.keys(props).length).toBeGreaterThan(0);
    expect(Object.keys(props)[0]).toBe("campaign"); // dropped from the end, in order
    expect(JSON.stringify(e[0].payload).length).toBeLessThan(2_000);
  });
  it("caps a 5,000 character event name", () => {
    const e = normalizeCleverTapEvent({ identity: "a@b.com", evtName: "n".repeat(5_000) });
    const p = e[0].payload as { eventName: string; message: string };
    expect(p.eventName.length).toBeLessThanOrEqual(120);
    expect(p.message.length).toBeLessThan(160);
  });
  it("strips control characters and newlines from names and string props", () => {
    const e = normalizeCleverTapEvent({ identity: "a@b.com", evtName: "Bad\nName\u0000\t\u001b[31m", evtData: { "sta\ntus": "line1\r\nline2\u0007" } });
    const p = e[0].payload as { eventName: string; message: string; props: Record<string, string> };
    const ctrl = /[\u0000-\u001f\u007f-\u009f]/;
    expect(ctrl.test(p.eventName)).toBe(false);
    expect(ctrl.test(p.message)).toBe(false);
    for (const [k, v] of Object.entries(p.props)) {
      expect(ctrl.test(k)).toBe(false);
      expect(ctrl.test(v)).toBe(false);
    }
    expect(p.props["sta tus"]).toBe("line1 line2");
  });
  it("ignores an event name that is only control characters", () => {
    expect(normalizeCleverTapEvent({ identity: "a@b.com", evtName: "\n\t\u0000" })).toEqual([]);
  });
});

describe("labelFor", () => {
  it("humanises snake_case names and leaves mixed-case names alone", () => {
    expect(labelFor("kyc_completed")).toBe("KYC completed");
    expect(labelFor("App Installed")).toBe("App Installed");
    expect(labelFor("KYC_COMPLETED")).toBe("KYC_COMPLETED".replace(/_/g, " "));
    expect(labelFor("a__b")).toBe("A b");
    expect(labelFor("___")).toBe("");
  });
});

const propsOf = (evtData: Record<string, unknown>) =>
  (normalizeCleverTapEvent({ identity: "a@b.com", evtName: "X", evtData })[0].payload as { props: Record<string, unknown> }).props;

describe("props allowlist and scrubbing", () => {
  it("keeps allowlisted keys case-insensitively across separators", () => {
    const props = propsOf({ Campaign: "Diwali", campaign_name: "n", "Campaign-Id": "c1", CHANNEL: "push", platform: "ios", source: "app", step: "ckyc", status: "ok", screen: "home", product: "mf", category: "x" });
    expect(Object.keys(props)).toHaveLength(11);
    expect(propsOf({ campaignName: "n" })).toEqual({ campaignName: "n" });
  });
  it("drops pan, Email, Phone, account_no, balance and any other key", () => {
    expect(propsOf({ pan: "x", Email: "a@b.com", Phone: "9876543210", account_no: "1", balance: 5, name: "R", step: "ckyc" })).toEqual({ step: "ckyc" });
  });
  it("redacts a PAN-looking value and long digit runs under an allowed key", () => {
    expect(propsOf({ step: "verified ABCDE1234F ok" })).toEqual({ step: "verified [redacted] ok" });
    expect(propsOf({ status: "acct 123456789012 done" })).toEqual({ status: "acct [redacted] done" });
  });
  it("drops numbers of 9 or more digits and keeps short ones and booleans", () => {
    expect(propsOf({ step: 123456789012, status: 3, screen: true, product: 123456789 })).toEqual({ status: 3, screen: true });
  });
  it("drops a __proto__ key without polluting", () => {
    const data = JSON.parse('{"__proto__":"x","step":"a"}');
    const props = propsOf(data);
    expect(Object.keys(props)).toEqual(["step"]);
    expect(({} as Record<string, unknown>).step).toBeUndefined();
  });
  it("strips bidi and zero-width characters from names, keys and values", () => {
    const e = normalizeCleverTapEvent({ identity: "a@b.com", evtName: "Kyc\u202eDone\u200b", evtData: { "st\u200bep": "a\u202eb\u200b" } });
    const p = e[0].payload as { eventName: string; message: string; props: Record<string, string> };
    const bad = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
    expect(bad.test(p.eventName + p.message + Object.keys(p.props).join("") + Object.values(p.props).join(""))).toBe(false);
    expect(p.props["st ep"]).toBe("a b");
  });
});

describe("labels", () => {
  it("falls back to the event name when the humanised label is empty", () => {
    for (const n of ["___", "_", "_ _"]) {
      const m = (normalizeCleverTapEvent({ identity: "a@b.com", evtName: n })[0].payload as { message: string }).message;
      expect(m).not.toBe("App event: ");
      expect(m.startsWith("App event: ")).toBe(true);
    }
    expect((normalizeCleverTapEvent({ identity: "a@b.com", evtName: "a__b" })[0].payload as { message: string }).message).toBe("App event: A b");
  });
});

describe("contact validation", () => {
  const email = (identity: string) => normalizeCleverTapEvent({ identity, evtName: "X" })[0]?.clientEmail;
  const phone = (identity: string) => normalizeCleverTapEvent({ identity, evtName: "X", evtData: { Email: "a@b.com" } })[0]?.clientPhone;
  it("lowercases emails and keeps plus-addressing", () => {
    expect(email("Riya@Example.COM")).toBe("riya@example.com");
    expect(email("riya+tag@example.com")).toBe("riya+tag@example.com");
  });
  it("accepts 10 to 15 digit phones with common separators", () => {
    expect(phone("(022) 2345-6789")).toBe("(022) 2345-6789");
    expect(phone("+1 (415) 555-2671")).toBe("+1 (415) 555-2671");
    expect(phone("98765.43210")).toBe("98765.43210");
  });
  it("rejects separator-only strings, 16-digit blobs, mid-string plus and short numbers", () => {
    expect(phone("--------")).toBeUndefined();
    expect(phone("1234567890123456")).toBeUndefined();
    expect(phone("98765+43210")).toBeUndefined();
    expect(phone("12345678")).toBeUndefined();
  });
  it("does not treat an 8-digit numeric identity as a phone", () => {
    expect(normalizeCleverTapEvent({ identity: "12345678", evtName: "X" })).toEqual([]);
  });
});
