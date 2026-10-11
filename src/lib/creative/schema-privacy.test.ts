import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The creative and report tables hold staff-written copy and aggregate numbers, never a customer. This pins that: none of them
 * has a Client relation or a clientId column, so the data-privacy erasure transaction needs no change for them. If one ever
 * gains a customer link, this test fails and the erasure transaction (and its database dump test) must be extended first.
 */
const MODELS = ["CreativeBrief", "CreativeVariant", "CreativeEvent", "CreativeTag", "BrandProfileVersion", "CompetitorWatch", "CompetitorAd", "Experiment", "ReportShare", "DirectorDigest", "CreativeSetting"];

const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const body = (name: string) => {
  const start = schema.indexOf(`\nmodel ${name} {`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("\n}\n", start));
};

describe("creative tables carry no customer data link", () => {
  for (const m of MODELS) {
    it(`${m} has no Client relation, no clientId and no personal-data column`, () => {
      const b = body(m);
      expect(b).not.toMatch(/\bClient\b/);
      expect(b).not.toMatch(/clientId/i);
      expect(b).not.toMatch(/\b(email|phone|mobile|pan|aadhaar)\b\s+\w/i);
    });
  }
  it("no creative or report table is in the set of tables that reference Client (so the erasure transaction and the foreign-key registry need no entry)", () => {
    const withClient = [...schema.matchAll(/\nmodel (\w+) \{([\s\S]*?)\n\}\n/g)].filter((m) => /^\s+\w+\s+Client\??(\[\])?\s+@relation/m.test(m[2])).map((m) => m[1]);
    expect(withClient.length).toBeGreaterThan(10);
    expect(withClient.filter((m) => MODELS.includes(m))).toEqual([]);
  });
  it("the migrations add only new things: no drop, no re-adding of the Role value, and the only alteration of an existing table is new columns on ReportShare", () => {
    for (const name of ["20270630000000_creative_reports", "20270631000000_creative_report_approvals"]) {
      const sql = readFileSync(path.join(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8");
      expect(sql, name).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
      expect(sql, name).not.toMatch(/ALTER TYPE/i);
      expect(sql, name).not.toMatch(/^\s*(UPDATE\b|DELETE\s+FROM\b)/im);
      const alters = sql.match(/ALTER\s+TABLE\s+"([A-Za-z]+)"/gi) ?? [];
      for (const a of alters) expect(a).toMatch(/"(CreativeVariant|CreativeEvent|CompetitorAd|ReportShare)"/);
    }
  });
});
