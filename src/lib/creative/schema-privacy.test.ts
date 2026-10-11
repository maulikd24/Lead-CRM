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
  it("the migration adds only new things: no drop, no alter of existing tables beyond the Role value", () => {
    const dir = path.join(process.cwd(), "prisma/migrations/20270340000000_creative_reports/migration.sql");
    const sql = readFileSync(dir, "utf8");
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
    const alters = sql.match(/ALTER\s+TABLE\s+"([A-Za-z]+)"/gi) ?? [];
    for (const a of alters) expect(a).toMatch(/"(CreativeVariant|CreativeEvent|CompetitorAd)"/);
    expect(sql).toMatch(/ALTER TYPE "Role" ADD VALUE 'MARKETING'/);
  });
});
