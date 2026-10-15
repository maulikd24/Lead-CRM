import { describe, expect, it } from "vitest";

import { DEFAULT_WINNER_SETTINGS, findWinners, TAG_TYPES, TAG_VOCAB, heuristicTags, parseAiTags, lengthBand, type TaggedCreative } from "./winners";

const c = (key: string, spend: number, funded: number, tags: TaggedCreative["tags"], status: "CONFIRMED" | "DRAFT" = "CONFIRMED"): TaggedCreative => ({ key, name: key, spend, funded, costPerFunded: funded > 0 ? spend / funded : null, tags, tagStatus: status });

describe("findWinners", () => {
  it("ranks by the cost per funded customer the provider gave, and does no cost arithmetic of its own", () => {
    const pool = [c("w1", 1000, 5, { hook: "question" }), c("w2", 1000, 4, { hook: "question" }), c("o1", 1000, 1, { hook: "process" }), c("o2", 1000, 1, { hook: "process" }), c("o3", 1000, 1, { hook: "checklist" }), c("o4", 1000, 1, { hook: "checklist" })];
    // The provider says w2 is cheaper than w1 even though w1 funded more: the ranking must follow the provider.
    const doctored = pool.map((x) => (x.key === "w2" ? { ...x, costPerFunded: 1 } : x.key === "w1" ? { ...x, costPerFunded: 900 } : x));
    const r = findWinners(doctored, { ...DEFAULT_WINNER_SETTINGS, minFundedTotal: 10, minCreatives: 6 });
    expect(r.winners.map((w) => w.key)).toEqual(["w2", "w1"]);
  });

  it("says not enough data on a handful of creatives", () => {
    const r = findWinners([c("a", 1000, 2, { hook: "question" }), c("b", 1000, 1, { hook: "process" })]);
    expect(r.state).toBe("not_enough_data");
    expect(r.reason).toMatch(/at least 6/);
  });

  it("says not enough data when almost nothing has funded", () => {
    const rows = Array.from({ length: 8 }, (_, i) => c(`x${i}`, 1000, i === 0 ? 1 : 0, { hook: "question" }));
    expect(findWinners(rows).state).toBe("not_enough_data");
  });

  it("finds what the cheapest funded creatives share", () => {
    const winners = [c("w1", 1000, 5, { hook: "question", format: "video", offer: "call" }), c("w2", 1000, 4, { hook: "question", format: "video", offer: "call" })];
    const others = [c("o1", 1000, 1, { hook: "process", format: "image", offer: "call" }), c("o2", 1000, 1, { hook: "process", format: "image", offer: "webinar" }), c("o3", 1000, 1, { hook: "checklist", format: "image", offer: "call" }), c("o4", 1000, 1, { hook: "process", format: "carousel", offer: "call" }), c("o5", 1000, 1, { hook: "question", format: "image", offer: "call" })];
    const r = findWinners([...winners, ...others], { ...DEFAULT_WINNER_SETTINGS, minFundedTotal: 10 });
    expect(r.state).toBe("ok");
    expect(r.winners.map((w) => w.key)).toEqual(["w1", "w2"]);
    const shared = r.shared.map((s) => `${s.type}:${s.value}`);
    expect(shared).toContain("hook:question");
    expect(shared).toContain("format:video");
    expect(shared).not.toContain("offer:call");
  });

  it("flags that draft tags were used", () => {
    const rows = Array.from({ length: 9 }, (_, i) => c(`x${i}`, 1000, i < 3 ? 4 : 1, { hook: i < 3 ? "question" : "process" }, "DRAFT"));
    const r = findWinners(rows, { ...DEFAULT_WINNER_SETTINGS, minFundedTotal: 10 });
    expect(r.usesDraftTags).toBe(true);
  });

  it("ignores creatives with no spend and with no tags at all", () => {
    const rows = [...Array.from({ length: 6 }, (_, i) => c(`x${i}`, 0, 0, {})), c("y", 100, 1, { hook: "question" })];
    expect(findWinners(rows).state).toBe("not_enough_data");
  });
});

describe("tags", () => {
  it("every type has a vocabulary", () => {
    for (const t of TAG_TYPES) expect(TAG_VOCAB[t].length).toBeGreaterThan(1);
  });
  it("length bands", () => {
    expect(lengthBand(30)).toBe("short");
    expect(lengthBand(180)).toBe("medium");
    expect(lengthBand(600)).toBe("long");
  });
  it("heuristic tags read format, hook, offer, length and CTA from the copy", () => {
    const t = heuristicTags({ copy: "Not sure how a demat account works? Book a 15-minute call.", format: "VIDEO" });
    expect(t).toMatchObject({ hook: "question", cta: "book_call", length: "short", format: "video" });
  });
  it("heuristic tags leave out what they cannot tell", () => {
    expect(heuristicTags({ copy: "", format: "" })).toEqual({});
  });
  it("AI tag replies are accepted only when they use the vocabulary", () => {
    expect(parseAiTags('{"hook":"question","offer":"call","cta":"book_call","format":"video","length":"short"}')).toMatchObject({ ok: true, tags: { hook: "question" } });
    expect(parseAiTags('{"hook":"clickbait"}')).toMatchObject({ ok: true, tags: {} });
    expect(parseAiTags("nonsense").ok).toBe(false);
  });
});
