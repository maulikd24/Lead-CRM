import { describe, expect, it, vi } from "vitest";

import { findMergedDuplicates } from "./merged-duplicates";

type Row = { id: string; clientCode: string; mobile: null; email: null; mergedIntoId: string };
const row = (id: string, into: string): Row => ({ id, clientCode: `C-${id}`, mobile: null, email: null, mergedIntoId: into });
const txOver = (rows: Row[]) => ({ client: { findMany: vi.fn(async ({ where }: { where: { mergedIntoId: { in: string[] } } }) => rows.filter((r) => where.mergedIntoId.in.includes(r.mergedIntoId))) } }) as never;

describe("findMergedDuplicates", () => {
  it("follows a chain of merges (a duplicate of a duplicate) and ignores unrelated merges", async () => {
    const tx = txOver([row("d1", "s"), row("d2", "d1"), row("d3", "d2"), row("x", "other")]);
    expect((await findMergedDuplicates(tx, "s")).map((d) => d.id).sort()).toEqual(["d1", "d2", "d3"]);
  });
  it("terminates on a loop in the data and never returns the survivor itself", async () => {
    const tx = txOver([row("d1", "s"), row("s", "d1")]);
    expect((await findMergedDuplicates(tx, "s")).map((d) => d.id)).toEqual(["d1"]);
  });
  it("returns nothing when nobody was merged in", async () => {
    expect(await findMergedDuplicates(txOver([]), "s")).toEqual([]);
  });
});
