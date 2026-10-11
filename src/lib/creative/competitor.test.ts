import { describe, expect, it, vi } from "vitest";

import { attachReference, createManualProvider, daysLive, getCompetitorAdsProvider, parseCompetitorCsv, referenceSummary, similarityToReferences, sortByDaysLive, suggestCompetitorTags, MAX_REFERENCES } from "./competitor";

const CSV = `competitor,copy,format,start_date,link,thumbnail_ref
Rival One,"Is your portfolio working, or just sitting?",video,2026-08-01,https://example.com/ad/1,thumb-001
Rival One,Free portfolio review this week,image,2026-09-20,https://example.com/ad/2,
Rival Two,"A ""calm"" start
to investing",carousel,,,
`;

describe("parseCompetitorCsv", () => {
  it("reads rows, quotes and line breaks inside quotes", () => {
    const r = parseCompetitorCsv(CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ competitor: "Rival One", copy: "Is your portfolio working, or just sitting?", format: "video", startDate: "2026-08-01", link: "https://example.com/ad/1", thumbnailRef: "thumb-001" });
    expect(r.rows[2].copy).toBe('A "calm" start\nto investing');
    expect(r.rows[2].startDate).toBeNull();
  });
  it("reports a bad row with its line and keeps the good ones", () => {
    const r = parseCompetitorCsv("competitor,copy,format,start_date,link,thumbnail_ref\nA,,video,2026-01-01,https://e.com,\nB,ok,image,31/12/2026,https://e.com,\nC,ok,image,2026-01-01,javascript:alert(1),\nD,fine,image,2026-01-01,https://e.com/x,");
    expect(r.rows.map((x) => x.competitor)).toEqual(["D"]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
  it("never accepts an embedded image as a thumbnail pointer", () => {
    const r = parseCompetitorCsv("competitor,copy,format,start_date,link,thumbnail_ref\nA,hello,image,2026-01-01,https://e.com,data:image/png;base64,AAAA");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].message).toMatch(/thumbnail/i);
  });
  it("needs the competitor and copy columns", () => {
    expect(parseCompetitorCsv("a,b\n1,2").errors[0].message).toMatch(/competitor/i);
  });
});

describe("days live and sorting", () => {
  it("counts whole days, and is null without a start date", () => {
    expect(daysLive("2026-09-01", "2026-09-11")).toBe(10);
    expect(daysLive(null, "2026-09-11")).toBeNull();
    expect(daysLive("2026-10-01", "2026-09-11")).toBe(0);
  });
  it("longest running first, unknown last", () => {
    const sorted = sortByDaysLive([{ id: "a", startDate: "2026-09-01" }, { id: "b", startDate: null }, { id: "c", startDate: "2026-07-01" }], "2026-09-11");
    expect(sorted.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("tags", () => {
  it("suggests a hook and an offer from the copy, as drafts", () => {
    expect(suggestCompetitorTags("Is your portfolio working, or just sitting?")).toMatchObject({ hook: "question" });
    expect(suggestCompetitorTags("Free portfolio review this week")).toMatchObject({ offer: "free_review" });
    expect(suggestCompetitorTags("Plain statement")).toEqual({ hook: null, offer: null });
  });
});

describe("providers", () => {
  it("only a manual provider exists and it makes no network call", async () => {
    const fetchSpy = vi.fn(() => { throw new Error("network used"); });
    vi.stubGlobal("fetch", fetchSpy);
    const p = getCompetitorAdsProvider();
    expect(p.name).toBe("manual");
    const ads = await createManualProvider([{ competitor: "R", copy: "c", format: "image", startDate: null, link: null, thumbnailRef: null }]).listAds({ name: "R" });
    expect(ads).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("references (inspiration only)", () => {
  it("attaches once, up to a limit", () => {
    expect(attachReference([], "a")).toEqual(["a"]);
    expect(attachReference(["a"], "a")).toEqual(["a"]);
    let refs: string[] = [];
    for (let i = 0; i < 12; i++) refs = attachReference(refs, `r${i}`);
    expect(refs).toHaveLength(MAX_REFERENCES);
  });
  it("the summary holds tags and facts, never the competitor's words", () => {
    const s = referenceSummary({ copy: "Is your portfolio working, or just sitting?", format: "video", hookTag: "question", offerTag: null, startDate: "2026-08-01" }, "2026-09-01");
    expect(s).toContain("question");
    expect(s).toContain("31 days");
    expect(s).not.toContain("portfolio");
  });
  it("detects copying: a draft that echoes a competitor's wording", () => {
    const comp = "Is your portfolio really working for you or just sitting there quietly";
    expect(similarityToReferences("Is your portfolio really working for you or just sitting there", [comp]).tooSimilar).toBe(true);
    expect(similarityToReferences("Learn how a demat account is opened step by step", [comp]).tooSimilar).toBe(false);
  });
});
