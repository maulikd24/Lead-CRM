import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ runUploadAction: vi.fn(), saveMappingAction: vi.fn() }));

import { PreviewPane, UploadForm, type UploadFlow } from "./upload-panel";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const flow = (over: Partial<UploadFlow> = {}): UploadFlow => ({
  kind: "HOLDINGS", file: null, previewed: false, result: null, pending: false,
  submit: () => {}, chooseKind: () => {}, chooseFile: () => {}, ...over,
});
const file = new File(["a"], "holdings.csv");
const outcome = (over: Record<string, unknown> = {}) => ({ ok: true as const, outcome: { kind: "HOLDINGS", status: "SUCCESS", dryRun: true, fileName: "holdings.csv", counts: {}, errors: [], ...over } as never });
/** The opening tag of the button whose text starts with `label`. */
const tag = (out: string, label: string) => out.split("<button").slice(1).map((b) => "<button" + b).find((b) => b.slice(b.indexOf(">") + 1).replace(/<[^>]+>/g, "").startsWith(label))?.split(">")[0] ?? "";

describe("Upload section", () => {
  it("offers the three kinds of file, a CSV picker, and a preview that needs a file", () => {
    const out = html(<UploadForm flow={flow()} />);
    for (const k of ["Client master", "Holdings", "Transactions"]) expect(out).toContain(k);
    expect(out).toContain('accept=".csv,text/csv"');
    expect(tag(out, "Preview (dry run)")).toContain(' disabled=""');
    expect(tag(html(<UploadForm flow={flow({ file })} />), "Preview (dry run)")).not.toContain(' disabled=""');
  });
  it("has no way to import for real: that only exists after a preview", () => {
    expect(html(<UploadForm flow={flow({ file })} />)).not.toContain("Import for real");
  });
});

describe("Preview section", () => {
  it("says there is nothing to preview and points back to Upload", () => {
    const out = html(<PreviewPane flow={flow()} onBack={() => {}} />);
    expect(out).toContain("Nothing to preview yet");
    expect(out).toContain("Go to Upload");
    expect(out).not.toContain("Import for real");
  });
  it("shows the dry run and keeps Import for real locked until the previewed file is still selected", () => {
    const locked = html(<PreviewPane flow={flow({ file, result: outcome() })} onBack={() => {}} />);
    expect(locked).toContain("Dry run: nothing was changed");
    expect(tag(locked, "Import for real")).toContain(' disabled=""');
    expect(locked).toContain("Preview the file first. Importing unlocks after that.");
    const open = html(<PreviewPane flow={flow({ file, previewed: true, result: outcome() })} onBack={() => {}} />);
    expect(tag(open, "Import for real")).not.toContain(' disabled=""');
  });
  it("offers a forced re-import only for a file that was already imported", () => {
    const dup = html(<PreviewPane flow={flow({ file, previewed: true, result: outcome({ status: "SKIPPED_DUPLICATE", reason: "already_imported", dryRun: false }) })} onBack={() => {}} />);
    expect(dup).toContain("Import again anyway");
    expect(html(<PreviewPane flow={flow({ file, previewed: true, result: outcome() })} onBack={() => {}} />)).not.toContain("Import again anyway");
  });
  it("shows a failure as an alert", () => {
    expect(html(<PreviewPane flow={flow({ result: { ok: false, message: "Choose a CSV file." } })} onBack={() => {}} />)).toContain('role="alert"');
  });
});
