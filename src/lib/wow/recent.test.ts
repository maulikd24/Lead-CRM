import { describe, expect, it } from "vitest";

import { RECENT_MAX, parseRecent, pushRecent, recentStorageKey, type RecentEntry } from "./recent";

const e = (key: string, kind: RecentEntry["kind"] = "nav"): RecentEntry => ({ kind, key, label: key, href: `/${key}` });

describe("pushRecent", () => {
  it("puts the newest first and drops an earlier copy", () => {
    expect(pushRecent([e("a"), e("b")], e("b")).map((x) => x.key)).toEqual(["b", "a"]);
  });
  it("keeps a page and a client with the same key apart", () => {
    expect(pushRecent([e("x", "client")], e("x", "nav"))).toHaveLength(2);
  });
  it("keeps at most five", () => {
    let list: RecentEntry[] = [];
    for (const k of "abcdefg") list = pushRecent(list, e(k));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].key).toBe("g");
  });
});

describe("parseRecent", () => {
  it("round-trips what was stored", () => {
    expect(parseRecent(JSON.stringify([e("a")]))).toEqual([{ kind: "nav", key: "a", label: "a", sublabel: undefined, href: "/a" }]);
  });
  it("ignores corrupt or hostile storage", () => {
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([{ kind: "nav", key: "x", label: "x", href: "https://evil.example" }]))).toEqual([]);
    expect(parseRecent(JSON.stringify([{ kind: "nav", key: "x", label: "x", href: "//evil.example" }]))).toEqual([]);
    expect(parseRecent(JSON.stringify([{ kind: "other", key: "x", label: "x", href: "/x" }]))).toEqual([]);
  });
  it("is stored per person", () => {
    expect(recentStorageKey("u1")).not.toBe(recentStorageKey("u2"));
  });
});
