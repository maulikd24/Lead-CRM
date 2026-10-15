import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { tradingAccount: { findMany: (a: unknown) => findMany(a) }, dataAccessLog: { create: async () => ({}) } } }));

import { ReferredClientsPanel } from "./referred-clients-panel";

const RAW = { id: "c1", name: "Asha Rao", clientCode: "CL-1", pan: "ABCDE1234F", ckycNumber: "50012345678901", mobile: "+919812345678", email: "asha.rao@example.com" };

describe("Partner Home referred clients (owner decision, DPDP minimisation)", () => {
  it("shows masked mobile and masked email only: no PAN, no CKYC, no raw contact detail", async () => {
    findMany.mockResolvedValue([{ client: RAW }]);
    const html = renderToStaticMarkup((await ReferredClientsPanel({ partnerProfileId: "p1", actor: { id: "u1", role: "PARTNER" } })) as React.ReactElement);
    expect(html).toContain("Asha Rao");
    expect(html).toContain("••••••5678");
    for (const raw of ["9812345678", "asha.rao@example.com", "ABCDE1234F", "50012345678901", "1234F", ">PAN<", "CKYC"]) expect(html, raw).not.toContain(raw);
  });

  it("never even selects PAN or CKYC from the database for this panel", async () => {
    findMany.mockResolvedValue([]);
    await ReferredClientsPanel({ partnerProfileId: "p1", actor: { id: "u1", role: "PARTNER" } });
    const select = findMany.mock.calls.at(-1)![0].include.client.select as Record<string, boolean>;
    expect(Object.keys(select).sort()).toEqual(["clientCode", "email", "id", "mobile", "name"]);
  });
});

describe("Partner native views read no PAN, CKYC, mobile or email", () => {
  const dir = join(__dirname, "../../../lib/partners/native");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !/\.(db\.)?test\.ts$/.test(f) && f !== "db-fixture.ts");
  const code = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("no native source mentions ckyc, mobile or an email field", () => {
    for (const f of files) expect(code(f), f).not.toMatch(/ckyc|\bmobile\b|\bemail\b/i);
  });
  it("PAN appears only as a presence flag in the statement query (the number itself is never selected)", () => {
    for (const f of files) {
      const src = code(f);
      if (f === "statement-queries.ts") expect(src.match(/panNumber/g)?.length, f).toBe(2); // IS NOT NULL / <> '' checks
      else expect(src, f).not.toMatch(/panNumber|\bpan\s*:\s*true/i);
    }
  });
});
