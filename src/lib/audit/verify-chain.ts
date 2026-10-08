import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { istDateKey } from "@/lib/utils/ist-date";
import { anchorConfigFromEnv, S3AnchorStore, type AnchorStore, type AuditAnchor } from "./anchor-store";

const VERIFY_JOB = "audit_chain_verify";
const ANCHOR_JOB = "audit_chain_anchor";
const ANCHOR_ALERT_JOB = "audit_chain_anchor_alert"; // caps "anchor write failed" alerts at one per day
const ANCHOR_LOOKBACK_DAYS = 30;

export type AuditChainProblem = { seq: bigint; id: string | null; problem: "seq_gap" | "prev_mismatch" | "hash_mismatch" | "head_mismatch" };
export type AnchorProblem = { date: string; seq: string; problem: "anchor_mismatch" | "anchor_row_missing" };

/** Recomputes the whole AuditLog hash chain in the DB (audit_log_verify(), see migration
 * 20261008000000_tamper_evident_audit_log). An empty result means no row was edited, removed or reordered. */
export async function verifyAuditChain(): Promise<{ rows: bigint; head: string; problems: AuditChainProblem[] }> {
  const [problems, head] = await Promise.all([
    prisma.$queryRaw<AuditChainProblem[]>`SELECT * FROM audit_log_verify()`,
    prisma.auditLogChainHead.findUnique({ where: { id: 1 } }),
  ]);
  return { rows: head?.seq ?? BigInt(0), head: head?.hash ?? "", problems };
}

/** Checks the last 30 days of off-database anchors against the rows they point at. This is what catches a
 * rewrite by someone who also recomputed every later hash — audit_log_verify() alone can't. */
export async function checkAnchors(store: AnchorStore, now = new Date()): Promise<{ checked: number; problems: AnchorProblem[] }> {
  const anchors = await store.listSince(istDateKey(new Date(now.getTime() - (ANCHOR_LOOKBACK_DAYS + 1) * 86_400_000)));
  const rows = await prisma.auditLog.findMany({
    where: { seq: { in: anchors.map((a) => BigInt(a.seq)) } },
    select: { seq: true, hash: true },
  });
  const hashBySeq = new Map(rows.map((r) => [r.seq.toString(), r.hash]));
  const problems: AnchorProblem[] = [];
  for (const anchor of anchors) {
    if (anchor.seq === "0") continue; // anchored an empty log
    const hash = hashBySeq.get(anchor.seq);
    if (hash === undefined) problems.push({ date: anchor.date, seq: anchor.seq, problem: "anchor_row_missing" });
    else if (hash !== anchor.hash) problems.push({ date: anchor.date, seq: anchor.seq, problem: "anchor_mismatch" });
  }
  return { checked: anchors.length, problems };
}

async function claimDailyRun(jobName: string, now: Date): Promise<boolean> {
  try {
    await prisma.dailyJobRun.create({ data: { jobName, ranForDate: istDateKey(now) } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

async function notifyAdmins(type: string, payload: Prisma.InputJsonValue) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  await prisma.notification.createMany({ data: admins.map((admin) => ({ userId: admin.id, type, payload })) });
}

function defaultAnchorStore(): AnchorStore | null {
  const config = anchorConfigFromEnv();
  return config ? new S3AnchorStore(config) : null;
}

/** Once per IST day: verify the chain, compare recent off-database anchors against it, then anchor today's
 * chain tip to write-once storage (S3 Object Lock). Admins are notified of any mismatch. The anchor write
 * retries on every tick until it succeeds, alerting at most once a day. The head hash is also logged. */
export async function runDailyAuditChainCheck(now = new Date(), store: AnchorStore | null = defaultAnchorStore()) {
  let verified: Awaited<ReturnType<typeof verifyAuditChain>> | null = null;
  let anchorProblems: number | null = null;
  let verify: Record<string, unknown> = { skipped: "already-ran" };

  if (await claimDailyRun(VERIFY_JOB, now)) {
    verified = await verifyAuditChain();
    const anchors = store ? await checkAnchors(store, now) : null;
    anchorProblems = anchors?.problems.length ?? null;
    console.log(JSON.stringify({ event: "audit_chain_verified", rows: verified.rows.toString(), head: verified.head, problems: verified.problems.length, anchorsChecked: anchors?.checked ?? null, anchorProblems: anchors?.problems.length ?? null }));

    if (verified.problems.length > 0) {
      const first = verified.problems[0];
      await notifyAdmins("audit_chain_broken", { problemCount: verified.problems.length, firstSeq: first.seq.toString(), firstProblem: first.problem });
    }
    if (anchors && anchors.problems.length > 0) {
      const first = anchors.problems[0];
      await notifyAdmins("audit_anchor_mismatch", { problemCount: anchors.problems.length, firstDate: first.date, firstSeq: first.seq });
    }
    verify = { rows: verified.rows.toString(), problems: verified.problems.length, anchorsChecked: anchors?.checked ?? null, anchorProblems: anchors?.problems.length ?? null };
  }

  if (!store) return { verify, anchor: "not-configured" as const };
  if (!(await claimDailyRun(ANCHOR_JOB, now))) return { verify, anchor: "already-anchored" as const };

  try {
    verified ??= await verifyAuditChain();
    const [{ name: database }] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    const anchor: AuditAnchor = {
      version: 1,
      date: istDateKey(now),
      seq: verified.rows.toString(),
      hash: verified.head,
      database,
      chainProblems: verified.problems.length,
      anchorProblems,
      createdAt: now.toISOString(),
    };
    const outcome = await store.put(anchor);
    console.log(JSON.stringify({ event: "audit_chain_anchored", outcome, date: anchor.date, seq: anchor.seq, hash: anchor.hash }));
    return { verify, anchor: outcome, seq: anchor.seq };
  } catch (error) {
    // Release the claim so the next tick retries; alert once a day so a persistent failure isn't silent or spammy.
    await prisma.dailyJobRun.deleteMany({ where: { jobName: ANCHOR_JOB, ranForDate: istDateKey(now) } });
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
    console.error("Audit anchor write failed", error);
    if (await claimDailyRun(ANCHOR_ALERT_JOB, now)) await notifyAdmins("audit_anchor_failed", { error: message });
    return { verify, anchor: { error: message } };
  }
}
