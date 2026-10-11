import { describe, expect, it } from "vitest";

import { MAX_THEMES_PER_ITEM, parseTagReply } from "./themes";

describe("parseTagReply", () => {
  it("reads a JSON theme list", () => {
    expect(parseTagReply('{"themes":["delay","fees"]}')).toEqual({ ok: true, themes: ["delay", "fees"] });
  });

  it("drops unknown theme names and duplicates, keeps the rest", () => {
    expect(parseTagReply('{"themes":["delay","made_up","delay","fees"]}')).toEqual({ ok: true, themes: ["delay", "fees"] });
  });

  it("caps the number of themes per item", () => {
    const r = parseTagReply('{"themes":["delay","fees","technology","communication","other"]}');
    expect(r.ok && r.themes).toHaveLength(MAX_THEMES_PER_ITEM);
  });

  it("returns an explicit abstain for an empty reply, never a guess", () => {
    expect(parseTagReply("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("returns malformed for non-JSON, a wrong shape, or no known theme", () => {
    expect(parseTagReply("the delay is about fees")).toEqual({ ok: false, reason: "malformed" });
    expect(parseTagReply('["delay"]')).toEqual({ ok: false, reason: "malformed" });
    expect(parseTagReply('{"themes":"delay"}')).toEqual({ ok: false, reason: "malformed" });
    expect(parseTagReply('{"themes":["made_up"]}')).toEqual({ ok: false, reason: "malformed" });
  });

  it("reads a model's own abstain as model_abstained", () => {
    expect(parseTagReply("ABSTAIN: do_not_know")).toEqual({ ok: false, reason: "model_abstained" });
  });
});
