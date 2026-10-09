import { describe, expect, it } from "vitest";
import { isAskIntent } from "./ask-intent";

describe("isAskIntent", () => {
  it("treats questions as ask intent", () => {
    expect(isAskIntent("Which KYC customers have not funded?")).toBe(true);
    expect(isAskIntent("which hni clients have high pms acceptance")).toBe(true);
    expect(isAskIntent("how many leads came from meta this week")).toBe(true);
  });
  it("leaves short searches and names to the normal search", () => {
    expect(isAskIntent("rajat")).toBe(false);
    expect(isAskIntent("settings")).toBe(false);
    expect(isAskIntent("")).toBe(false);
  });
});
