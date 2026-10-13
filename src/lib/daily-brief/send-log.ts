// The DailyBriefLog send log shared by the RM daily briefs (the 09:00 morning brief and the 18:00 evening one).
// One row per (RM, IST date, channel). The channel keeps the two briefs apart: "email" for the morning, "evening" for
// the evening, so a send of one never blocks the other. The claim and finish rules are the same for both (see job.ts).

export type BriefRm = { id: string; name: string; email: string };
export type PendingRm = { rmId: string; name: string };
export type BriefStatus = "dry_run" | "sent" | "failed" | "skipped_empty" | "already_done" | "error";
/** Stored as the log row's JSON counts. */
export type SendLogCounts = Record<string, number>;

export type SendLog = {
  /** Active RMs who have not opted out. `rm` narrows to one RM by id or email (testing). */
  listRms(rm: string | null): Promise<BriefRm[]>;
  /** RMs whose log row for (date, channel) is still "pending". Read-only: the job never retries or expires these. */
  listPending(date: string, channel: string): Promise<PendingRm[]>;
  /** Returns true when this caller now owns the send for (rm, date, channel). */
  claim(rmId: string, date: string, channel: string, counts: SendLogCounts): Promise<boolean>;
  finish(rmId: string, date: string, channel: string, status: "sent" | "failed" | "skipped_empty", counts: SendLogCounts, error: string | null): Promise<void>;
};

export const ERROR_MAX = 300;
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX);

/** The subject and body date, e.g. "Tue, 13 Oct" (IST). */
export const dateLabel = (now: Date) =>
  now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" });

/** The real send log. Loaded lazily so importing this module never touches the database. */
export async function loadPrismaSendLog(): Promise<SendLog> {
  const { prisma } = await import("@/lib/db/prisma");
  const { Prisma } = await import("@/generated/prisma/client");
  return {
    async listRms(rm) {
      return prisma.user.findMany({
        where: {
          role: "RM",
          isActive: true,
          dailyBriefOptOut: false,
          ...(rm ? { OR: [{ id: rm }, { email: rm }] } : {}),
        },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      });
    },

    async listPending(date, channel) {
      const rows = await prisma.dailyBriefLog.findMany({
        where: { date, channel, status: "pending" },
        select: { rmId: true, rm: { select: { name: true } } },
        orderBy: { rm: { name: "asc" } },
      });
      return rows.map((r) => ({ rmId: r.rmId, name: r.rm.name }));
    },

    async claim(rmId, date, channel, counts) {
      try {
        await prisma.dailyBriefLog.create({ data: { rmId, date, channel, status: "pending", counts: { ...counts } } });
        return true;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        // Row already exists: take it over only if its last attempt did not complete a send.
        const { count } = await prisma.dailyBriefLog.updateMany({
          where: { rmId, date, channel, status: { in: ["failed", "skipped_empty"] } },
          data: { status: "pending", error: null, counts: { ...counts } },
        });
        return count === 1;
      }
    },

    async finish(rmId, date, channel, status, counts, error) {
      await prisma.dailyBriefLog.update({
        where: { rmId_date_channel: { rmId, date, channel } },
        data: { status, counts: { ...counts }, error },
      });
    },
  };
}
