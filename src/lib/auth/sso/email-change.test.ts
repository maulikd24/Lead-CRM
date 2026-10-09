import { describe, expect, it, vi } from "vitest";

import { checkOwnEmailChange } from "./email-change";

const deps = (conflict: { id: string } | null = null, ssoEnabled = false) => ({
  ssoEnabled,
  findOtherUserByEmail: vi.fn(async () => conflict),
});

describe("checkOwnEmailChange", () => {
  it("allows an unchanged email even with SSO on (name-only edit)", async () => {
    expect(await checkOwnEmailChange("u1", "a@x.com", "a@x.com", deps(null, true))).toEqual({ ok: true });
  });
  it("blocks any change while SSO is enabled", async () => {
    const r = await checkOwnEmailChange("u1", "a@x.com", "A@x.com", deps(null, true));
    expect(r).toEqual({ ok: false, message: "Your email is managed by single sign-on" });
  });
  it("without SSO, refuses an email that collides case-insensitively with another user", async () => {
    const d = deps({ id: "u2" });
    expect(await checkOwnEmailChange("u1", "a@x.com", "CEO@x.com", d)).toEqual({
      ok: false,
      message: "A user with this email already exists",
    });
    expect(d.findOtherUserByEmail).toHaveBeenCalledWith("CEO@x.com", "u1");
  });
  it("without SSO, allows a free email", async () => {
    expect(await checkOwnEmailChange("u1", "a@x.com", "b@x.com", deps(null))).toEqual({ ok: true });
  });
});
