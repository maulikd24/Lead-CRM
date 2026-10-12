import { describe, expect, it } from "vitest";
import { CSV_HEADER, consentCsv } from "./csv";

const row = (o: Record<string, unknown> = {}) => ({
  clientCode: "CL-00001", purpose: "MARKETING_COMMS", channel: null, status: "WITHDRAWN", source: "WHATSAPP_KEYWORD",
  noticeVersion: "v2", capturedAt: new Date("2026-10-09T10:00:00Z"), expiresAt: null, ...o,
});

describe("consentCsv", () => {
  it("has a header with the client code and no personal data columns", () => {
    expect(CSV_HEADER).toEqual(["clientCode", "purpose", "channel", "status", "source", "noticeVersion", "capturedAt", "expiresAt"]);
    for (const h of CSV_HEADER) expect(h).not.toMatch(/name|email|mobile|phone|pan|reason|evidence|capturedBy/i);
  });
  it("writes ISO timestamps and blanks for nulls", () => {
    const out = consentCsv([row()]).split("\n");
    expect(out[0]).toBe('"clientCode","purpose","channel","status","source","noticeVersion","capturedAt","expiresAt"');
    expect(out[1]).toBe('"CL-00001","MARKETING_COMMS","","WITHDRAWN","WHATSAPP_KEYWORD","v2","2026-10-09T10:00:00.000Z",""');
  });
  it("neutralises spreadsheet formulas and quotes", () => {
    const out = consentCsv([row({ noticeVersion: '=HYPERLINK("x")' })]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it("ignores any extra field on the input rows", () => {
    const out = consentCsv([{ ...row(), name: "Riya Sharma", reason: "called", capturedById: "u1" } as never]);
    expect(out).not.toContain("Riya");
    expect(out).not.toContain("called");
    expect(out).not.toContain("u1");
  });
});
