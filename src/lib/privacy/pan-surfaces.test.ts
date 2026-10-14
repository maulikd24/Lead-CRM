import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Surfaces that reach the browser, an export or an AI prompt must never select or print a customer's PAN. The only places that
 * touch it are the masked client page, the audited reveal, duplicate checks and server-side KYC / matching. A new use in one of
 * these files fails here and needs a decision.
 */
const FILES = [
  "app/(dashboard)/clients/quick-view-actions.ts",
  "app/(dashboard)/command-search-actions.ts",
  "app/(dashboard)/clients/page.tsx",
  "app/(dashboard)/clients/client-row.tsx",
  "app/(dashboard)/households/actions.ts",
  "app/api/clients/export/route.ts",
  "lib/palette/universal-search.ts",
  "lib/ai/summaries/builders.ts",
  "lib/copilot/worklist.ts",
  "lib/dashboard/manager-attention.ts",
];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

describe("PAN stays out of browser, export and AI surfaces", () => {
  for (const f of FILES) {
    it(f, () => {
      const code = strip(readFileSync(join(__dirname, "../..", f), "utf8"));
      expect(code).not.toMatch(/\bpan\b/i);
    });
  }
});
