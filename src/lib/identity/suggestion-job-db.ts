import { prisma } from "@/lib/db/prisma";
import { comparableEmail, comparablePhone } from "./duplicate-score";
import { runMergeSuggestionJob, type Anchor, type ExistingSuggestion, type JobDeps, type JobOptions, type WritePlan } from "./suggestion-job";

/**
 * The scan position and the "resting until" time live in two SystemHeartbeat rows (key + a timestamp, which is all a cursor over
 * createdAt needs). That table is internal, not admin-editable, and already holds the cron lease, so no migration is required.
 */
export const CURSOR_KEY = "merge_suggestions_cursor";
export const REST_KEY = "merge_suggestions_rest_until";

const LIVE = { isDeleted: false, mergedIntoId: null } as const;
const SELECT = { id: true, name: true, mobile: true, email: true, pan: true, createdAt: true } as const;
const MAX_PARTNERS = 5000;

async function getStamp(key: string): Promise<Date | null> {
  return (await prisma.systemHeartbeat.findUnique({ where: { key } }))?.lastAt ?? null;
}
async function setStamp(key: string, at: Date | null) {
  if (!at) await prisma.systemHeartbeat.deleteMany({ where: { key } });
  else await prisma.systemHeartbeat.upsert({ where: { key }, update: { lastAt: at }, create: { key, lastAt: at } });
}

export function dbDeps(): JobDeps {
  return {
    enabled: () => process.env.MERGE_SUGGESTIONS_ENABLED === "1",
    now: () => new Date(),
    loadState: async () => ({ cursor: await getStamp(CURSOR_KEY), restUntil: await getStamp(REST_KEY) }),
    saveCursor: (c) => setStamp(CURSOR_KEY, c),
    saveRestUntil: (d) => setStamp(REST_KEY, d),
    loadAnchors: async (after, limit): Promise<Anchor[]> => {
      const rows = await prisma.client.findMany({
        where: { ...LIVE, ...(after ? { createdAt: { gt: after } } : {}) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
        select: SELECT,
      });
      if (rows.length === limit) {
        // Customers imported in one batch can share a createdAt; take the rest of the tie so the cursor never skips any.
        const ties = await prisma.client.findMany({
          where: { ...LIVE, createdAt: rows[rows.length - 1].createdAt, id: { notIn: rows.map((r) => r.id) } },
          take: 500,
          select: SELECT,
        });
        rows.push(...ties);
      }
      return rows;
    },
    loadPartners: async (anchors) => {
      const keys = [...new Set(anchors.map((a) => comparablePhone(a.mobile)).filter((p): p is string => !!p))];
      const emails = [...new Set(anchors.map((a) => comparableEmail(a.email)).filter((e): e is string => !!e))];
      if (keys.length === 0 && emails.length === 0) return [];
      // Indexed lookup on the shared identity keys (Client.mobileKey / emailKey, kept in sync by the Prisma extension); the exact scorer filters afterwards.
      return prisma.$queryRaw<Anchor[]>`
        SELECT id, name, mobile, email, pan, "createdAt" FROM "Client"
        WHERE "isDeleted" = false AND "mergedIntoId" IS NULL AND (
          ("mobileKey" = ANY(${keys}::text[]))
          OR ("emailKey" = ANY(${emails}::text[])))
        LIMIT ${MAX_PARTNERS}`;
    },
    loadExisting: async (pairs): Promise<ExistingSuggestion[]> => {
      const out: ExistingSuggestion[] = [];
      for (let i = 0; i < pairs.length; i += 200) {
        const rows = await prisma.mergeSuggestion.findMany({
          where: { OR: pairs.slice(i, i + 200).map(([clientAId, clientBId]) => ({ clientAId, clientBId })) },
          select: { clientAId: true, clientBId: true, status: true, score: true, reasons: true },
        });
        out.push(...rows);
      }
      return out;
    },
    write: async (plan: WritePlan) => {
      if (plan.create.length) await prisma.mergeSuggestion.createMany({ data: plan.create, skipDuplicates: true });
      // updateMany with the expected status: a reviewer deciding at the same moment always wins over the scanner.
      for (const s of plan.refresh) {
        await prisma.mergeSuggestion.updateMany({ where: { clientAId: s.clientAId, clientBId: s.clientBId, status: "OPEN" }, data: { score: s.score, reasons: s.reasons } });
      }
      for (const s of plan.reopen) {
        await prisma.mergeSuggestion.updateMany({
          where: { clientAId: s.clientAId, clientBId: s.clientBId, status: "DISMISSED" },
          data: { status: "OPEN", decidedAt: null, score: s.score, reasons: s.reasons },
        });
      }
    },
  };
}

/** Cron entry: a no-op unless MERGE_SUGGESTIONS_ENABLED=1. */
export function runMergeSuggestions(opts?: JobOptions) {
  return runMergeSuggestionJob(dbDeps(), opts);
}
