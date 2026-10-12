import { describe, expect, it } from "vitest";

import { DEFAULT_DISCLAIMER, effectiveDisclaimer, parseSignoff, signoffState, wordingHash } from "./disclosure";
import { checkInviteDraft, composeInviteDraft } from "./message";

describe("the safe default wording", () => {
  it("is non-empty, free of amounts and promises, and passes the invitation checks as the message ending", () => {
    expect(DEFAULT_DISCLAIMER.length).toBeGreaterThan(40);
    const draft = composeInviteDraft({ referrerFirstName: "Asha", link: "https://example.test/join?ref=ABCD2345", disclaimer: DEFAULT_DISCLAIMER });
    expect(checkInviteDraft(draft, DEFAULT_DISCLAIMER)).toEqual({ ok: true });
  });
  it("says rewards are not promised and that investments carry market risk", () => {
    expect(DEFAULT_DISCLAIMER).toMatch(/market risk/i);
    expect(DEFAULT_DISCLAIMER).toMatch(/programme terms|terms/i);
  });
});

describe("effectiveDisclaimer", () => {
  it("uses the custom wording when there is some, trimmed", () => expect(effectiveDisclaimer("  Our wording.  ")).toEqual({ text: "Our wording.", source: "custom" }));
  it.each([null, undefined, "", "   "])("falls back to the default for %j", (v) => expect(effectiveDisclaimer(v as string | null)).toEqual({ text: DEFAULT_DISCLAIMER, source: "default" }));
});

describe("wordingHash", () => {
  it("is stable, sensitive to every character, and does not depend on surrounding whitespace", () => {
    expect(wordingHash("Terms apply.")).toBe(wordingHash("  Terms apply.\n"));
    expect(wordingHash("Terms apply.")).not.toBe(wordingHash("Terms apply"));
    expect(wordingHash("a")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("parseSignoff", () => {
  it("reads a well-formed record and rejects anything else", () => {
    const ok = JSON.stringify({ by: "u-1", approver: "A. Reviewer", at: "2027-01-10T10:00:00.000Z", hash: "h" });
    expect(parseSignoff(ok)).toEqual({ by: "u-1", approver: "A. Reviewer", at: "2027-01-10T10:00:00.000Z", hash: "h" });
    for (const bad of [null, "", "not json", "[]", "{}", JSON.stringify({ by: "u", approver: "", at: "x", hash: "h" }), JSON.stringify({ by: 1, approver: "a", at: "x", hash: "h" })]) expect(parseSignoff(bad)).toBeNull();
  });
});

describe("signoffState", () => {
  const record = (text: string, over: Record<string, unknown> = {}) => JSON.stringify({ by: "u-2", approver: "A. Reviewer", at: "2027-01-10T10:00:00.000Z", hash: wordingHash(text), ...over });
  it("is signed off only when the record matches the wording in force", () => {
    expect(signoffState({ custom: "Our wording.", signoff: record("Our wording.") })).toMatchObject({ signedOff: true, source: "custom", approver: "A. Reviewer" });
    expect(signoffState({ custom: "Our wording, edited.", signoff: record("Our wording.") })).toMatchObject({ signedOff: false });
    expect(signoffState({ custom: null, signoff: record(DEFAULT_DISCLAIMER) })).toMatchObject({ signedOff: true, source: "default" });
    expect(signoffState({ custom: null, signoff: record("something else") })).toMatchObject({ signedOff: false });
  });
  it("is not signed off with no record or a broken one", () => {
    expect(signoffState({ custom: null, signoff: null })).toMatchObject({ signedOff: false, text: DEFAULT_DISCLAIMER });
    expect(signoffState({ custom: null, signoff: "garbage" })).toMatchObject({ signedOff: false });
  });
  it("whoever last edited the wording cannot be the one who signs it off", () => {
    expect(signoffState({ custom: "Our wording.", signoff: record("Our wording.", { by: "u-1" }), editor: "u-1" })).toMatchObject({ signedOff: false, selfApproved: true });
    expect(signoffState({ custom: "Our wording.", signoff: record("Our wording.", { by: "u-2" }), editor: "u-1" })).toMatchObject({ signedOff: true });
  });
  it("the editor rule does not apply to the built-in wording (nobody edited it)", () => {
    expect(signoffState({ custom: null, signoff: record(DEFAULT_DISCLAIMER, { by: "u-1" }), editor: "u-1" })).toMatchObject({ signedOff: true });
  });
});
