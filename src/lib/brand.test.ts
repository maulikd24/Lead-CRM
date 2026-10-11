import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BRAND, pageTitle } from "./brand";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("brand", () => {
  it("names the product Allvest with a Customer OS subtitle", () => {
    expect(BRAND.name).toBe("Allvest");
    expect(BRAND.subtitle).toBe("Customer OS");
    expect(BRAND.full).toBe("Allvest Customer OS");
    expect(pageTitle("Clients")).toBe("Clients · Allvest");
  });

  it("keeps the open-source credit text", () => {
    expect(BRAND.credit).toBe("Built on Supportify (open source)");
  });

  it("leaves no user-visible 'Supportify' in source (identifiers, comments and the credit excepted)", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      if (file.endsWith("/lib/brand.ts")) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (!line.includes("Supportify")) return;
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
