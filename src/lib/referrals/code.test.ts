import { describe, expect, it } from "vitest";

import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, normalizeCode, shareLink } from "./code";

describe("generateCode", () => {
  it("is 8 characters from an alphabet without look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
    for (const bad of ["0", "O", "1", "I", "L", "U"]) expect(CODE_ALPHABET).not.toContain(bad);
  });
  it("uses the injected random source (deterministic in tests)", () => {
    expect(generateCode(() => 0)).toBe(CODE_ALPHABET[0].repeat(CODE_LENGTH));
  });
  it("does not repeat across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateCode()));
    expect(seen.size).toBe(2000);
  });
});

describe("normalizeCode", () => {
  it("accepts any case, dashes and spaces", () => {
    expect(normalizeCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeCode(" ab cd 23 45 ")).toBe("ABCD2345");
  });
  it("rejects wrong length, look-alikes and junk", () => {
    expect(normalizeCode("ABCD234")).toBeNull();
    expect(normalizeCode("ABCD2340")).toBeNull();
    expect(normalizeCode("ABCD-23'5")).toBeNull();
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });
});

describe("formatCode", () => {
  it("groups in fours", () => expect(formatCode("ABCD2345")).toBe("ABCD-2345"));
});

describe("shareLink", () => {
  it("needs a configured https base", () => {
    expect(shareLink(undefined, "ABCD2345")).toBeNull();
    expect(shareLink("http://example.test/join", "ABCD2345")).toBeNull();
    expect(shareLink("not a url", "ABCD2345")).toBeNull();
  });
  it("adds the code as a query parameter, keeping existing ones", () => {
    expect(shareLink("https://example.test/join", "ABCD2345")).toBe("https://example.test/join?ref=ABCD2345");
    expect(shareLink("https://example.test/join?utm=x", "ABCD2345")).toBe("https://example.test/join?utm=x&ref=ABCD2345");
  });
});
