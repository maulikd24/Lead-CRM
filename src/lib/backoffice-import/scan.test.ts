import { describe, expect, it } from "vitest";

import { DEFAULT_MAPPING } from "./mapping";
import { scanDirectory, type FsLike } from "./scan";
import { createDeps } from "./testkit";

function fakeFs(files: Record<string, { text: string; symlink?: boolean; size?: number }>): FsLike & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readdir: async () => Object.keys(files),
    lstat: async (p) => {
      const f = files[p.split("/").pop()!];
      return { isFile: () => !f.symlink, isSymbolicLink: () => Boolean(f.symlink), size: f.size ?? f.text.length };
    },
    readFile: async (p) => {
      reads.push(p.split("/").pop()!);
      return files[p.split("/").pop()!].text;
    },
  };
}

const HOLD = "clientCode,accountNumber,productCode,quantity,asOfDate\nCL-1,A1,P1,10,2026-10-01";
const CLI = "clientCode,name,city\nCL-1,Asha,Pune";

describe("scanDirectory", () => {
  it("imports recognised files in order clients, holdings, transactions and ignores everything else", async () => {
    const t = createDeps();
    const fs = fakeFs({ "holdings_1.csv": { text: HOLD }, "clients_1.csv": { text: CLI }, "notes.txt": { text: "x" }, "readme.csv": { text: "x" }, "..evil.csv": { text: "x" } });
    const r = await scanDirectory({ dir: "/data/in", mapping: DEFAULT_MAPPING, deps: t.deps, fs });
    expect(fs.reads).toEqual(["clients_1.csv", "holdings_1.csv"]);
    expect(r).toMatchObject({ files: 2, imported: 2, skippedDuplicate: 0, failed: 0 });
    expect(t.runs.rows.map((x) => [x.kind, x.trigger, x.dryRun])).toEqual([["CLIENTS", "CRON", false], ["HOLDINGS", "CRON", false]]);
  });
  it("a second scan of the same files imports nothing (checksums)", async () => {
    const t = createDeps();
    const fs = fakeFs({ "holdings_1.csv": { text: HOLD } });
    await scanDirectory({ dir: "/d", mapping: DEFAULT_MAPPING, deps: t.deps, fs });
    const writes = t.feedRepo.state.writes;
    const again = await scanDirectory({ dir: "/d", mapping: DEFAULT_MAPPING, deps: t.deps, fs });
    expect(again).toMatchObject({ files: 1, imported: 0, skippedDuplicate: 1 });
    expect(t.feedRepo.state.writes).toBe(writes);
    expect(t.runs.rows).toHaveLength(1);
  });
  it("refuses symlinks and oversize files without reading them", async () => {
    const t = createDeps();
    const fs = fakeFs({ "holdings_a.csv": { text: HOLD, symlink: true }, "holdings_b.csv": { text: HOLD, size: 99_000_000 } });
    const r = await scanDirectory({ dir: "/d", mapping: DEFAULT_MAPPING, deps: t.deps, fs });
    expect(fs.reads).toEqual([]);
    expect(r).toMatchObject({ files: 0, refused: 2 });
  });
  it("caps files per scan", async () => {
    const t = createDeps();
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`holdings_${i}.csv`, { text: HOLD.replace("10", String(i + 1)) }]));
    const r = await scanDirectory({ dir: "/d", mapping: DEFAULT_MAPPING, deps: t.deps, fs: fakeFs(files), maxFiles: 2 });
    expect(r.files).toBe(2);
    expect(r.deferred).toBe(3);
  });
  it("a missing directory is reported, not thrown", async () => {
    const t = createDeps();
    const fs: FsLike = { readdir: async () => { throw Object.assign(new Error("ENOENT /secret/path"), { code: "ENOENT" }); }, lstat: async () => { throw new Error("x"); }, readFile: async () => "" };
    const r = await scanDirectory({ dir: "/nope", mapping: DEFAULT_MAPPING, deps: t.deps, fs });
    expect(r).toMatchObject({ files: 0, directoryError: "ENOENT" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
