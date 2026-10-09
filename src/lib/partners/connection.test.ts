import { describe, expect, it } from "vitest";
import { resolveConnection } from "./connection";

describe("resolveConnection", () => {
  it("is mock when there is no row or the row is in mock mode", () => {
    expect(resolveConnection(null)).toEqual({ state: "mock" });
    expect(resolveConnection({ mode: "mock", isEnabled: true, credentials: { baseUrl: "https://a.test", token: "t" } })).toEqual({ state: "mock" });
  });
  it("is not connected when live but incomplete or disabled", () => {
    expect(resolveConnection({ mode: "live", isEnabled: true, credentials: {} })).toEqual({ state: "not_connected" });
    expect(resolveConnection({ mode: "live", isEnabled: true, credentials: { baseUrl: "https://a.test" } })).toEqual({ state: "not_connected" });
    expect(resolveConnection({ mode: "live", isEnabled: false, credentials: { baseUrl: "https://a.test", token: "t" } })).toEqual({ state: "not_connected" });
    expect(resolveConnection({ mode: "live", isEnabled: true, credentials: { baseUrl: "http://not-secure.test", token: "t" } })).toEqual({ state: "not_connected" });
  });
  it("is live with a valid https base URL and token", () => {
    expect(resolveConnection({ mode: "live", isEnabled: true, credentials: { baseUrl: " https://a.test/ ", token: " tok " } })).toEqual({ state: "live", baseUrl: "https://a.test", token: "tok" });
  });
});
