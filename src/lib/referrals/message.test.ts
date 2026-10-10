import { describe, expect, it } from "vitest";

import { checkInviteDraft, composeInviteDraft } from "./message";

const DISCLAIMER = "Referral rewards, if any, follow the programme terms. Investments are subject to market risks.";

describe("composeInviteDraft", () => {
  it("builds a short invitation with the link, no amounts, and the disclaimer appended verbatim", () => {
    const d = composeInviteDraft({ referrerFirstName: "Asha", link: "https://example.test/join?ref=ABCD2345", disclaimer: DISCLAIMER });
    expect(d).toContain("Asha");
    expect(d).toContain("https://example.test/join?ref=ABCD2345");
    expect(d.endsWith(DISCLAIMER)).toBe(true);
    expect(d).not.toMatch(/[0-9]+\s*%|₹|rs\.?\s*\d/i);
  });
});

describe("checkInviteDraft", () => {
  const good = composeInviteDraft({ referrerFirstName: "Asha", link: "https://example.test/join?ref=ABCD2345", disclaimer: DISCLAIMER });
  it("passes the composed draft", () => expect(checkInviteDraft(good, DISCLAIMER)).toEqual({ ok: true }));
  it("blocks sending when no disclaimer is configured", () => {
    expect(checkInviteDraft(good, "")).toMatchObject({ ok: false, code: "NO_DISCLAIMER" });
    expect(checkInviteDraft(good, undefined)).toMatchObject({ ok: false, code: "NO_DISCLAIMER" });
  });
  it("requires the disclaimer to be present in the text (an edited draft cannot drop it)", () => {
    expect(checkInviteDraft(good.replace(DISCLAIMER, ""), DISCLAIMER)).toMatchObject({ ok: false, code: "MISSING_DISCLAIMER" });
  });
  it("runs the agent guardrails on the body: guaranteed-return language is blocked", () => {
    const bad = `Invite a friend, guaranteed returns for everyone!\n\n${DISCLAIMER}`;
    expect(checkInviteDraft(bad, DISCLAIMER)).toMatchObject({ ok: false, code: "RETURN_PROMISE" });
  });
  it("blocks reward amounts and earnings promises", () => {
    expect(checkInviteDraft(`Refer a friend and earn ₹500 today.\n\n${DISCLAIMER}`, DISCLAIMER)).toMatchObject({ ok: false, code: "REWARD_PROMISE" });
    expect(checkInviteDraft(`Refer a friend and get Rs 500.\n\n${DISCLAIMER}`, DISCLAIMER)).toMatchObject({ ok: false, code: "REWARD_PROMISE" });
  });
  it("blocks echoed identifiers", () => {
    expect(checkInviteDraft(`Call 9876543210 now\n\n${DISCLAIMER}`, DISCLAIMER)).toMatchObject({ ok: false, code: "PII_ECHO" });
  });
});
