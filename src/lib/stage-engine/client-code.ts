import { prisma } from "@/lib/db/prisma";

/**
 * Generates the next sequential human-readable client code, e.g. "CL-00001".
 *
 * Deliberately scans every "CL-<digits>" code and takes the numeric max, rather than trusting
 * createdAt ordering — other code prefixes now exist in the same table (e.g. "CL-DEMO-06" from
 * the stakeholder demo seed), so the most-recently-created row isn't reliably the highest-numbered
 * one, and parsing a non-numeric suffix would silently fall back to 0 and collide with an
 * already-used low code.
 */
export async function generateClientCode(): Promise<string> {
  const codes = await prisma.client.findMany({
    where: { clientCode: { startsWith: "CL-" } },
    select: { clientCode: true },
  });

  const lastNumber = codes.reduce((max, { clientCode }) => {
    const match = /^CL-(\d+)$/.exec(clientCode);
    if (!match) return max;
    return Math.max(max, parseInt(match[1], 10));
  }, 0);

  const next = lastNumber + 1;
  return `CL-${String(next).padStart(5, "0")}`;
}
