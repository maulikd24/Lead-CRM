import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(async () => ({ user: { id: "admin-1", role: "ADMIN" } })),
  runImport: vi.fn(async () => ({ status: "SUCCESS", kind: "HOLDINGS", dryRun: true, counts: {}, errors: [], checksum: "x", fileName: "a.csv", errorsTruncated: false })),
  saveMapping: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: m.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/backoffice-import/prisma-deps", () => ({ loadMapping: vi.fn(async () => ({})), prismaRunDeps: vi.fn(() => ({})), saveMapping: m.saveMapping }));
vi.mock("@/lib/backoffice-import/runner", () => ({ runImport: m.runImport }));

import { runUploadAction, saveMappingAction } from "./actions";

const form = (over: Record<string, string | File> = {}) => {
  const f = new FormData();
  f.set("kind", "HOLDINGS");
  f.set("file", new File(["a,b\n1,2"], "holdings.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BACKOFFICE_IMPORT_ENABLED", "1");
});

describe("runUploadAction", () => {
  it("is admin-only", async () => {
    await runUploadAction(form());
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });
  it("does nothing when the flag is off", async () => {
    vi.stubEnv("BACKOFFICE_IMPORT_ENABLED", "");
    expect(await runUploadAction(form())).toEqual({ ok: false, message: "The back-office import is switched off." });
    expect(m.runImport).not.toHaveBeenCalled();
  });
  it("defaults to a dry run, and only a literal dryRun=false applies", async () => {
    await runUploadAction(form());
    expect(m.runImport).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true, trigger: "UPLOAD", userId: "admin-1", kind: "HOLDINGS" }), expect.anything(), expect.anything());
    await runUploadAction(form({ dryRun: "false" }));
    expect(m.runImport).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }), expect.anything(), expect.anything());
  });
  it("rejects a missing file, a bad kind and an oversize file without importing", async () => {
    expect(await runUploadAction(form({ kind: "NOPE" }))).toMatchObject({ ok: false });
    const empty = new FormData();
    empty.set("kind", "CLIENTS");
    expect(await runUploadAction(empty)).toMatchObject({ ok: false });
    const big = new File([new Uint8Array(5_000_001)], "holdings.csv");
    expect(await runUploadAction(form({ file: big }))).toMatchObject({ ok: false });
    expect(m.runImport).not.toHaveBeenCalled();
  });
  it("replaces an unsafe file name", async () => {
    await runUploadAction(form({ file: new File(["a\n1"], "../../etc/pa ss.csv") }));
    expect(m.runImport).toHaveBeenLastCalledWith(expect.objectContaining({ fileName: "upload.csv" }), expect.anything(), expect.anything());
  });
});

describe("saveMappingAction", () => {
  it("rejects non-JSON and reports invalid paths only", async () => {
    expect(await saveMappingAction("{")).toMatchObject({ ok: false });
    m.saveMapping.mockResolvedValueOnce({ ok: false, issues: [{ path: "holdings", code: "duplicate_column" }] } as never);
    expect(await saveMappingAction("{}")).toEqual({ ok: false, message: "The mapping was not saved. Check: holdings." });
  });
  it("is admin-only and flag-gated", async () => {
    await saveMappingAction("{}");
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
    vi.stubEnv("BACKOFFICE_IMPORT_ENABLED", "");
    expect(await saveMappingAction("{}")).toMatchObject({ ok: false });
  });
});
