import { describe, expect, it } from "vitest";

import { checkFile, fileKind, formatBytes } from "./file-dropzone-logic";

describe("fileKind", () => {
  it("picks the icon family from the extension or the type", () => {
    expect(fileKind("holdings.CSV", "")).toBe("sheet");
    expect(fileKind("a.xlsx", "")).toBe("sheet");
    expect(fileKind("scan.pdf", "application/pdf")).toBe("doc");
    expect(fileKind("pan.png", "image/png")).toBe("image");
    expect(fileKind("notes.txt", "text/plain")).toBe("doc");
    expect(fileKind("x.bin", "")).toBe("other");
  });
});

describe("formatBytes", () => {
  it("reads like a person would say it", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("checkFile", () => {
  const f = (name: string, size: number, type = "") => ({ name, size, type });
  it("accepts a matching extension within the size limit", () => {
    expect(checkFile(f("a.csv", 100), ".csv,text/csv", 5 * 1024 * 1024)).toBeNull();
  });
  it("refuses the wrong kind of file, in plain words", () => {
    expect(checkFile(f("a.pdf", 100, "application/pdf"), ".csv,text/csv", 1000)).toMatch(/csv/i);
  });
  it("refuses a file that is too large and says the limit", () => {
    expect(checkFile(f("a.csv", 6 * 1024 * 1024), ".csv", 5 * 1024 * 1024)).toMatch(/5 MB/);
  });
  it("accepts anything when no accept list is given", () => {
    expect(checkFile(f("a.zip", 10), undefined, 100)).toBeNull();
  });
});
