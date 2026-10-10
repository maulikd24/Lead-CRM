import { describe, expect, it, vi } from "vitest";

import { DEFAULT_MAPPING } from "./mapping";
import { runBackOfficeImportTick, type TickDeps } from "./tick";

const deps = (over: Partial<TickDeps> = {}): TickDeps & { scan: ReturnType<typeof vi.fn>; loadMapping: ReturnType<typeof vi.fn> } => ({
  env: { BACKOFFICE_IMPORT_ENABLED: "1", BACKOFFICE_IMPORT_DIR: "/data/in" } as unknown as NodeJS.ProcessEnv,
  now: () => Date.parse("2026-10-09T21:10:00Z"),
  cronRanSince: vi.fn(async () => false),
  loadMapping: vi.fn(async () => DEFAULT_MAPPING),
  scan: vi.fn(async () => ({ files: 1, imported: 1, skippedDuplicate: 0, failed: 0, refused: 0, deferred: 0 })),
  ...over,
});

describe("runBackOfficeImportTick", () => {
  it("does nothing, touching nothing, when the flag is off", async () => {
    const d = deps({ env: {} as NodeJS.ProcessEnv });
    expect(await runBackOfficeImportTick(d)).toEqual({ skipped: "disabled" });
    expect(d.loadMapping).not.toHaveBeenCalled();
    expect(d.scan).not.toHaveBeenCalled();
    expect(d.cronRanSince).not.toHaveBeenCalled();
  });
  it("skips without a drop directory", async () => {
    const d = deps({ env: { BACKOFFICE_IMPORT_ENABLED: "1" } as unknown as NodeJS.ProcessEnv });
    expect(await runBackOfficeImportTick(d)).toEqual({ skipped: "no_directory" });
    expect(d.scan).not.toHaveBeenCalled();
  });
  it("only runs inside the nightly hour (default 21:00 UTC)", async () => {
    const d = deps({ now: () => Date.parse("2026-10-09T10:00:00Z") });
    expect(await runBackOfficeImportTick(d)).toEqual({ skipped: "outside_window" });
    expect(d.scan).not.toHaveBeenCalled();
    const custom = deps({ env: { BACKOFFICE_IMPORT_ENABLED: "1", BACKOFFICE_IMPORT_DIR: "/d", BACKOFFICE_IMPORT_HOUR_UTC: "10" } as unknown as NodeJS.ProcessEnv, now: () => Date.parse("2026-10-09T10:00:00Z") });
    expect((await runBackOfficeImportTick(custom)).skipped).toBeUndefined();
  });
  it("runs once per day", async () => {
    const d = deps({ cronRanSince: vi.fn(async () => true) });
    expect(await runBackOfficeImportTick(d)).toEqual({ skipped: "already_ran_today" });
    expect(d.scan).not.toHaveBeenCalled();
  });
  it("scans the configured directory with the stored mapping and returns counts only", async () => {
    const d = deps();
    const r = await runBackOfficeImportTick(d);
    expect(d.scan).toHaveBeenCalledWith(expect.objectContaining({ dir: "/data/in", mapping: DEFAULT_MAPPING }));
    expect(r).toEqual({ ran: true, files: 1, imported: 1, skippedDuplicate: 0, failed: 0, refused: 0, deferred: 0 });
  });
});
