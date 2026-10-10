import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve(__dirname, "../../../prisma/migrations/20261210000000_learning_insights_indexes");
const sql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

describe("learning insights index migration", () => {
  it("contains only plain, idempotent CREATE INDEX statements", () => {
    expect(statements).toHaveLength(3);
    for (const s of statements) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS "[A-Za-z_]+" ON "[A-Za-z]+"\("[A-Za-z]+"(, "[A-Za-z]+")*\)$/);
  });
  it("cannot change or remove anything: no DROP/ALTER/UPDATE/DELETE/CREATE UNIQUE/CONCURRENTLY outside comments", () => {
    const code = statements.join(";\n");
    expect(code).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|UNIQUE|USING|WHERE|INSERT)\b/i);
  });
  it("says in its header that it is additive and safe to drop", () => {
    const header = sql.split("\n").filter((l) => l.startsWith("--")).join("\n").toLowerCase();
    expect(header).toContain("additive");
    expect(header).toContain("safe to drop");
  });
  it("matches the indexes declared in schema.prisma, so a migrate diff stays clean", () => {
    const schema = fs.readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf8");
    const block = (m: string) => schema.slice(schema.indexOf(`model ${m} {`), schema.indexOf("\n}\n", schema.indexOf(`model ${m} {`)));
    expect(block("Message")).toContain("@@index([direction, channel, createdAt])");
    expect(block("InteractionOutcome")).toContain("@@index([createdAt])");
    expect(block("AgentProposal")).toContain("@@index([decidedAt])");
  });
});
