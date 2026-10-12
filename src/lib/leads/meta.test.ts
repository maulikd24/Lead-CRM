import { afterEach, describe, expect, it, vi } from "vitest";

// meta.ts imports the Prisma client and the ingest pipeline; this test only exercises the Graph call.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/generated/prisma/client", () => ({ Prisma: {} }));
vi.mock("@/lib/leads/ingest", () => ({ ingestLead: vi.fn() }));

import { fetchGraphLead } from "./meta";

afterEach(() => vi.unstubAllGlobals());

it("fetches a lead with the page token in the Authorization header, not the query string", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "L1" }), { status: 200 });
    }),
  );
  const lead = await fetchGraphLead("L1", "PAGETOKEN");
  expect(lead.id).toBe("L1");
  expect(calls[0].url).not.toContain("access_token");
  expect(calls[0].url).not.toContain("PAGETOKEN");
  expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer PAGETOKEN");
});
