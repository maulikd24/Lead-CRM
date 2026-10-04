import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { istDateKey } from "@/lib/utils/ist-date";

const JOB_NAME = "audit_chain_verify";

export type AuditChainProblem = { seq: bigint; id: string | null; problem: "seq_gap" | "prev_mismatch" | "hash_mismatch" | "head_mismatch" };

/** Recomputes the whole AuditLog hash chain in the DB (audit_log_verify(), see migration
 * 20261008000000_tamper_evident_audit_log). An empty result means no row was edited, removed or reordered. */
export async function verifyAuditChain(): Promise<{ rows: bigint; head: string; problems: AuditChainProblem[] }> {
  const [problems, head] = await Promise.all([
    prisma.$queryRaw<AuditChainProblem[]>`SELECT * FROM audit_log_verify()`,
    prisma.auditLogChainHead.findUnique({ where: { id: 1 } }),
  ]);
  return { rows: head?.seq ?? BigInt(0), head: head?.hash ?? "", problems };
}

/** Once per IST day: verify the chain and notify every Admin if it is broken. The head hash is logged so
 * it lands in Vercel's log retention — an off-database anchor to compare against if the DB itself is suspect. */
export async function runDailyAuditChainCheck(now = new Date()) {
  try {
    await prisma.dailyJobRun.create({ data: { jobName: JOB_NAME, ranForDate: istDateKey(now) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { skipped: "already-ran" as const };
    }
    throw error;
  }

  const result = await verifyAuditChain();
  console.log(JSON.stringify({ event: "audit_chain_verified", rows: result.rows.toString(), head: result.head, problems: result.problems.length }));

  if (result.problems.length > 0) {
    const first = result.problems[0];
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: "audit_chain_broken",
        payload: { problemCount: result.problems.length, firstSeq: first.seq.toString(), firstProblem: first.problem },
      })),
    });
  }
  return { rows: result.rows.toString(), problems: result.problems.length };
}
