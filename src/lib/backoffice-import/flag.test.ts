import { describe, expect, it } from "vitest";

import { backofficeImportConfigured, backofficeImportDir, backofficeImportEnabled } from "./flag";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("flag", () => {
  it("is off unless BACKOFFICE_IMPORT_ENABLED is exactly 1 (the same rule as every other flag, and as the nav flag)", () => {
    expect(backofficeImportEnabled(env({}))).toBe(false);
    expect(backofficeImportEnabled(env({ BACKOFFICE_IMPORT_ENABLED: "0" }))).toBe(false);
    expect(backofficeImportEnabled(env({ BACKOFFICE_IMPORT_ENABLED: "yes" }))).toBe(false);
    expect(backofficeImportEnabled(env({ BACKOFFICE_IMPORT_ENABLED: "1" }))).toBe(true);
    expect(backofficeImportEnabled(env({ BACKOFFICE_IMPORT_ENABLED: "true" }))).toBe(false);
  });
  it("the directory is only returned when the flag is on and the path is absolute", () => {
    expect(backofficeImportDir(env({ BACKOFFICE_IMPORT_DIR: "/data/in" }))).toBeNull();
    expect(backofficeImportDir(env({ BACKOFFICE_IMPORT_ENABLED: "1" }))).toBeNull();
    expect(backofficeImportDir(env({ BACKOFFICE_IMPORT_ENABLED: "1", BACKOFFICE_IMPORT_DIR: "relative/dir" }))).toBeNull();
    expect(backofficeImportDir(env({ BACKOFFICE_IMPORT_ENABLED: "1", BACKOFFICE_IMPORT_DIR: "/data/in" }))).toBe("/data/in");
  });
  it("configured means flag on (uploads need no directory)", () => {
    expect(backofficeImportConfigured(env({ BACKOFFICE_IMPORT_ENABLED: "1" }))).toBe(true);
    expect(backofficeImportConfigured(env({}))).toBe(false);
  });
});
