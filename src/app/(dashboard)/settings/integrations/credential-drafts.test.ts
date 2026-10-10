import { beforeEach, describe, expect, it } from "vitest";

import { clearAllDrafts, clearDraft, readDraft, writeDraft } from "./credential-drafts";

beforeEach(() => clearAllDrafts());

describe("credential drafts (typed but not yet saved)", () => {
  it("starts empty", () => {
    expect(readDraft("meta_ads")).toEqual({});
  });
  it("keeps what was typed per provider and field, so a card that remounts on a tab switch gets it back", () => {
    writeDraft("meta_ads", "accessToken", "abc");
    writeDraft("meta_ads", "adAccountId", "act_1");
    writeDraft("google_ads", "developerToken", "xyz");
    expect(readDraft("meta_ads")).toEqual({ accessToken: "abc", adAccountId: "act_1" });
    expect(readDraft("google_ads")).toEqual({ developerToken: "xyz" });
  });
  it("hands out copies, so a caller cannot change the store by accident", () => {
    writeDraft("meta_ads", "accessToken", "abc");
    const copy = readDraft("meta_ads");
    copy.accessToken = "changed";
    expect(readDraft("meta_ads").accessToken).toBe("abc");
  });
  it("clearing one provider leaves the others; clearing all leaves nothing", () => {
    writeDraft("meta_ads", "a", "1");
    writeDraft("clevertap", "b", "2");
    clearDraft("meta_ads");
    expect(readDraft("meta_ads")).toEqual({});
    expect(readDraft("clevertap")).toEqual({ b: "2" });
    clearAllDrafts();
    expect(readDraft("clevertap")).toEqual({});
  });
  it("forgets a field that was emptied again", () => {
    writeDraft("meta_ads", "a", "1");
    writeDraft("meta_ads", "a", "");
    expect(readDraft("meta_ads")).toEqual({});
  });
});
