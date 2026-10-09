import { describe, expect, it } from "vitest";
import { resolveConnection } from "./connection";
import { CONTRACT_VERSION } from "./contract";

const dev = { production: false, allowSample: false };
const prod = { production: true, allowSample: false };
const live = (credentials: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ mode: "live", isEnabled: true, credentials, ...extra });

describe("resolveConnection", () => {
  it("is mock outside production when there is no row or the row is in mock mode", () => {
    expect(resolveConnection(null, dev)).toEqual({ state: "mock" });
    expect(resolveConnection({ mode: "mock", isEnabled: true, credentials: { baseUrl: "https://a.test", token: "t" } }, dev)).toEqual({ state: "mock" });
  });
  it("is NOT connected in production for no row or mock mode, unless sample data is explicitly allowed", () => {
    expect(resolveConnection(null, prod)).toEqual({ state: "not_connected" });
    expect(resolveConnection({ mode: "mock", isEnabled: true, credentials: {} }, prod)).toEqual({ state: "not_connected" });
    expect(resolveConnection(null, { production: true, allowSample: true })).toEqual({ state: "mock" });
  });
  it("is not connected when live but incomplete or disabled", () => {
    expect(resolveConnection(live({}), dev)).toEqual({ state: "not_connected" });
    expect(resolveConnection(live({ baseUrl: "https://a.test" }), dev)).toEqual({ state: "not_connected" });
    expect(resolveConnection({ ...live({ baseUrl: "https://a.test", token: "t" }), isEnabled: false }, dev)).toEqual({ state: "not_connected" });
    expect(resolveConnection(live({ baseUrl: "http://not-secure.test", token: "t" }), dev)).toEqual({ state: "not_connected" });
  });
  it("is live with a valid base URL and token, with an empty path prefix by default and the contract unverified", () => {
    expect(resolveConnection(live({ baseUrl: " https://a.test/ ", token: " tok " }), dev)).toEqual({ state: "live", baseUrl: "https://a.test", token: "tok", pathPrefix: "", contractVerified: false });
  });
  it("reads the path prefix from the saved details", () => {
    const c = resolveConnection(live({ baseUrl: "https://a.test", token: "t", pathPrefix: "/v2/x/" }), dev);
    expect(c).toMatchObject({ state: "live", pathPrefix: "/v2/x" });
  });
  it("is verified only when the saved verification date is valid AND matches the current contract version", () => {
    const creds = { baseUrl: "https://a.test", token: "t" };
    const ok = resolveConnection(live(creds, { settings: { contractVerifiedAt: "2026-10-10T00:00:00Z", contractVersion: CONTRACT_VERSION } }), dev);
    expect(ok).toMatchObject({ contractVerified: true });
    const stale = resolveConnection(live(creds, { settings: { contractVerifiedAt: "2026-10-10T00:00:00Z", contractVersion: "older" } }), dev);
    expect(stale).toMatchObject({ contractVerified: false });
    const noDate = resolveConnection(live(creds, { settings: { contractVersion: CONTRACT_VERSION } }), dev);
    expect(noDate).toMatchObject({ contractVerified: false });
    const junk = resolveConnection(live(creds, { settings: { contractVerifiedAt: "not a date", contractVersion: CONTRACT_VERSION } }), dev);
    expect(junk).toMatchObject({ contractVerified: false });
  });
});
