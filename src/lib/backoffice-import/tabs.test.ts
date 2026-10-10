import { describe, expect, it } from "vitest";

import { IMPORT_TABS, runLine } from "./tabs";

describe("back-office import tabs", () => {
  it("follow the path of a file: Upload, Preview, Runs, Mapping", () => {
    expect(IMPORT_TABS.map((t) => t.label)).toEqual(["Upload", "Preview", "Runs", "Mapping"]);
  });
  it("describes a run by what it was and how it began", () => {
    expect(runLine(true, "UPLOAD")).toBe("Preview, uploaded");
    expect(runLine(false, "CRON")).toBe("Import, nightly job");
  });
});
