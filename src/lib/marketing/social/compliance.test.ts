import { describe, expect, it } from "vitest";

import { REGISTRATION_PLACEHOLDER, SOCIAL_CHANNELS, STANDARD_RISK_LINE, appendRequiredDisclosures, checkPost, hasBlockingIssue } from "./compliance";

const REG = "SEBI Registration No: INZ000123456";
const compliant = (text: string) => `${text}\n\n${STANDARD_RISK_LINE}\n${REG}`;
const codes = (body: string, channel = "linkedin") => checkPost({ channel, body }).issues.map((i) => i.code);

describe("checkPost: what the agent safety layer already blocks", () => {
  it("passes a plain educational post with the mandatory disclosures", () => {
    const r = checkPost({ channel: "linkedin", body: compliant("Opening a demat account takes three steps: identity proof, bank details and a short video verification.") });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("blocks promised or guaranteed returns, in English and Hinglish", () => {
    expect(codes(compliant("Guaranteed 12% returns every year"))).toContain("RETURN_PROMISE");
    expect(codes(compliant("Risk-free way to grow your money"))).toContain("RETURN_PROMISE");
    expect(codes(compliant("Is mein pakka returns milega"))).toContain("RETURN_PROMISE");
  });

  it("blocks investment advice and performance figures", () => {
    expect(codes(compliant("You should buy this fund now"))).toContain("ADVICE");
    expect(codes(compliant("Our PMS delivered 24% last year"))).toContain("PERFORMANCE_CLAIM");
  });

  it("the standard risk line itself never trips the safety layer", () => {
    expect(codes(compliant("How a systematic investment plan works."))).toEqual([]);
  });

  it("allows posts longer than a WhatsApp message, up to the channel limit", () => {
    const long = "Understanding portfolio diversification. ".repeat(30);
    expect(codes(compliant(long)).includes("TOO_LONG")).toBe(false);
    const tooLong = "a ".repeat(SOCIAL_CHANNELS.instagram.maxLength);
    expect(codes(compliant(tooLong), "instagram")).toContain("TOO_LONG");
  });

  it("an empty post is blocked", () => {
    expect(codes("  ")).toContain("EMPTY");
  });
});

describe("checkPost: ad-copy rules for a regulated firm", () => {
  it("blocks urgency and pressure", () => {
    for (const text of ["Last chance to open an account", "Don't miss out on this", "Hurry, open today", "Limited time offer on brokerage"]) {
      expect(codes(compliant(text)), text).toContain("URGENCY");
    }
  });

  it("blocks unverifiable superlatives", () => {
    for (const text of ["India's best broker", "The safest way to invest", "We are number one in service"]) {
      expect(codes(compliant(text)), text).toContain("SUPERLATIVE");
    }
  });

  it("blocks get-rich hype", () => {
    for (const text of ["Easy money from the markets", "The secret the insiders use"]) expect(codes(compliant(text)), text).toContain("HYPE");
  });

  it("blocks an unresolved placeholder, so a draft with [CONFIRM] text can never be approved", () => {
    expect(codes(`Learn about demat accounts.\n\n${STANDARD_RISK_LINE}\n${REGISTRATION_PLACEHOLDER}`)).toContain("PLACEHOLDER");
    expect(codes(compliant("Fee terms: [FEE TERMS - CONFIRM WITH PRODUCT NOTE]"))).toContain("PLACEHOLDER");
  });
});

describe("checkPost: mandatory disclosures", () => {
  it("requires the market-risk statement", () => {
    expect(codes(`Learn about demat accounts.\n${REG}`)).toContain("MISSING_RISK_STATEMENT");
  });

  it("requires a SEBI registration line with a registration number", () => {
    expect(codes(`Learn about demat accounts.\n${STANDARD_RISK_LINE}`)).toContain("MISSING_REGISTRATION");
    expect(codes(`Learn about demat accounts.\n${STANDARD_RISK_LINE}\nSEBI registered`)).toContain("MISSING_REGISTRATION");
  });

  it("a long post cannot hide the disclosure: it has to fit within the channel limit with it", () => {
    const body = compliant("x ".repeat(SOCIAL_CHANNELS.linkedin.maxLength));
    expect(codes(body)).toContain("TOO_LONG");
  });
});

describe("appendRequiredDisclosures", () => {
  it("adds the risk line and a registration PLACEHOLDER once, and the result is blocked until a human fills it", () => {
    const withBlock = appendRequiredDisclosures("Learn about demat accounts.");
    expect(withBlock).toContain(STANDARD_RISK_LINE);
    expect(withBlock).toContain(REGISTRATION_PLACEHOLDER);
    expect(appendRequiredDisclosures(withBlock)).toBe(withBlock);
    expect(codes(withBlock)).toEqual(["PLACEHOLDER"]);
  });

  it("does not add the registration placeholder when a registration line is already there", () => {
    const out = appendRequiredDisclosures(`Hello.\n${REG}`);
    expect(out).not.toContain(REGISTRATION_PLACEHOLDER);
    expect(out).toContain(STANDARD_RISK_LINE);
  });
});

describe("hasBlockingIssue", () => {
  it("is true for any issue (every rule here blocks approval)", () => {
    expect(hasBlockingIssue(checkPost({ channel: "linkedin", body: "Guaranteed returns" }))).toBe(true);
    expect(hasBlockingIssue(checkPost({ channel: "linkedin", body: compliant("Plain education about KYC.") }))).toBe(false);
  });
});

describe("channels", () => {
  it("lists the supported channels with their limits; X is left out because its limit cannot hold the mandatory disclosures", () => {
    expect(Object.keys(SOCIAL_CHANNELS).sort()).toEqual(["facebook", "instagram", "linkedin", "youtube"]);
    expect(checkPost({ channel: "x", body: compliant("hi") }).issues.map((i) => i.code)).toContain("UNKNOWN_CHANNEL");
  });
});
