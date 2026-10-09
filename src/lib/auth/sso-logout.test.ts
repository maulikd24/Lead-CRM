import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }));
const decodeMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => jar.cookies }) }));
vi.mock("next-auth/jwt", () => ({ decode: decodeMock }));

import { joinSessionCookie, ssoEndSessionUrl } from "./sso-logout";

describe("joinSessionCookie", () => {
  const b = "authjs.session-token";
  it("returns a whole cookie, joins chunks in numeric order, ignores unrelated names", () => {
    expect(joinSessionCookie([{ name: b, value: "abc" }], b)).toBe("abc");
    expect(
      joinSessionCookie(
        [
          { name: `${b}.10`, value: "C" },
          { name: `${b}.2`, value: "B" },
          { name: `${b}.0`, value: "A" },
          { name: `${b}.x`, value: "no" },
          { name: "other", value: "no" },
        ],
        b,
      ),
    ).toBe("ABC");
    expect(joinSessionCookie([], b)).toBeNull();
  });
});

describe("ssoEndSessionUrl", () => {
  const ENV = {
    SSO_ENABLED: "1",
    KEYCLOAK_ISSUER: "https://id.example.com/realms/main",
    KEYCLOAK_CLIENT_ID: "crm",
    KEYCLOAK_CLIENT_SECRET: "x",
    AUTH_SECRET: "s",
  };
  beforeEach(() => {
    decodeMock.mockReset();
    jar.cookies = [{ name: "authjs.session-token", value: "enc" }];
  });
  it("builds the provider logout URL only from config plus the stored id token", async () => {
    decodeMock.mockResolvedValue({ sso: true, idToken: "IDT" });
    const u = new URL((await ssoEndSessionUrl(ENV, "https://crm.example.com/login"))!);
    expect(u.origin + u.pathname).toBe("https://id.example.com/realms/main/protocol/openid-connect/logout");
    expect(u.searchParams.get("id_token_hint")).toBe("IDT");
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe("https://crm.example.com/login");
  });
  it("is null for non-SSO sessions, SSO off, missing secret, no cookie, or a decode failure", async () => {
    decodeMock.mockResolvedValue({ idToken: "IDT" });
    expect(await ssoEndSessionUrl(ENV, "https://crm.example.com/login")).toBeNull();
    decodeMock.mockResolvedValue({ sso: true });
    expect(await ssoEndSessionUrl({ ...ENV, SSO_ENABLED: undefined }, "https://crm.example.com/login")).toBeNull();
    expect(await ssoEndSessionUrl({ ...ENV, AUTH_SECRET: undefined }, "https://crm.example.com/login")).toBeNull();
    jar.cookies = [];
    expect(await ssoEndSessionUrl(ENV, "https://crm.example.com/login")).toBeNull();
    jar.cookies = [{ name: "authjs.session-token", value: "enc" }];
    decodeMock.mockRejectedValue(new Error("bad"));
    expect(await ssoEndSessionUrl(ENV, "https://crm.example.com/login")).toBeNull();
  });
});
