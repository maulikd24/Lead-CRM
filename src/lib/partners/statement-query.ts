import type { Role } from "@/generated/prisma/client";
import { detailAllows, type PartnerScope } from "./native/scope";
import { monthLabel, parseStatementPeriod, fyLabel } from "./native/period";
import { readSettings } from "./settings";

/**
 * "Raise a query" on a statement line: a partner questions a line, and it lands on Finance as an ordinary Task (the existing
 * task model), with a record of the query and an audit entry. One open query per person and line; asking again is a no-op.
 */
export const MIN_QUERY_MESSAGE = 5;
export const MAX_QUERY_MESSAGE = 500;
const MAX_TITLE = 200;

export function validateQueryMessage(raw: unknown): { ok: true; message: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write what looks wrong." };
  const message = raw.replace(/\s+/g, " ").trim();
  if (message.length < MIN_QUERY_MESSAGE) return { ok: false, error: `Write at least ${MIN_QUERY_MESSAGE} characters about what looks wrong.` };
  if (message.length > MAX_QUERY_MESSAGE) return { ok: false, error: `Keep it to ${MAX_QUERY_MESSAGE} characters or fewer.` };
  return { ok: true, message };
}

export function queryTaskTitle(i: { partnerCode: string; periodLabel: string; message: string }): string {
  const head = `Partner query ${i.partnerCode} (${i.periodLabel}): `;
  const room = MAX_TITLE - head.length;
  return head + (i.message.length > room ? `${i.message.slice(0, room - 1).trimEnd()}…` : i.message);
}

/** Who gets the task: the person Finance named in Settings if they are active and Finance or Admin, else the first active Finance user, else the first active Admin. */
export function pickAssignee(i: { configured: { id: string; role: string; isActive: boolean } | null; finance: string[]; admins: string[] }): string | null {
  if (i.configured && i.configured.isActive && (i.configured.role === "FINANCE" || i.configured.role === "ADMIN")) return i.configured.id;
  return i.finance[0] ?? i.admins[0] ?? null;
}

export type QueryDb = {
  commissionAccrual: { findFirst(a: unknown): Promise<{ id: string; accrualDate: Date; revenueEvent: { clientId: string | null } } | null> };
  commissionAdjustment: { findFirst(a: unknown): Promise<{ id: string } | null> };
  partnerProfile: { findUnique(a: unknown): Promise<{ id: string; partnerCode: string } | null> };
  tradingAccount: { findFirst(a: unknown): Promise<{ clientId: string } | null> };
  partnerStatementQuery: { findFirst(a: unknown): Promise<{ id: string; taskId: string | null } | null>; create(a: { data: Record<string, unknown> }): Promise<{ id: string }>; update(a: { where: { id: string }; data: { taskId: string } }): Promise<unknown> };
  partnerWorkspaceSetting: { findMany(): Promise<{ key: string; value: unknown }[]> };
  user: { findUnique(a: unknown): Promise<{ id: string; role: string; isActive: boolean } | null>; findMany(a: unknown): Promise<{ id: string }[]> };
  task: { create(a: { data: Record<string, unknown> }): Promise<{ id: string }>; findFirst(a: unknown): Promise<{ id: string } | null> };
  auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
  $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T>;
};

export type RaiseResult =
  | { ok: true; queryId: string; taskId: string; duplicate: boolean }
  | { ok: false; code: "invalid" | "not_allowed" | "not_found" | "no_client" | "no_assignee"; error: string };

const DUE_MS = 48 * 60 * 60 * 1000;

export async function raiseStatementQuery(
  db: QueryDb,
  actor: { id: string; role: Role },
  scope: PartnerScope,
  input: { partnerId: string; period: string; lineRef: string; message: string },
  now: Date,
): Promise<RaiseResult> {
  const msg = validateQueryMessage(input.message);
  if (!msg.ok) return { ok: false, code: "invalid", error: msg.error };
  const period = parseStatementPeriod(input.period);
  if (!period || !/^[A-Za-z0-9:_-]{1,80}$/.test(input.lineRef)) return { ok: false, code: "invalid", error: "That statement line could not be identified." };
  // Only the lines a viewer may see can be queried: a sub-partner's lines and everything for a team manager are out of reach.
  if (!detailAllows(scope, input.partnerId)) return { ok: false, code: "not_allowed", error: "You cannot raise a query on this statement." };

  const partner = await db.partnerProfile.findUnique({ where: { id: input.partnerId }, select: { id: true, partnerCode: true } });
  if (!partner) return { ok: false, code: "not_found", error: "That statement line was not found." };

  let clientId: string | null = null;
  if (input.lineRef.startsWith("adjustment:")) {
    const adj = await db.commissionAdjustment.findFirst({ where: { id: input.lineRef.slice("adjustment:".length), partnerProfileId: input.partnerId, ...(scope.kind === "all" ? {} : { OR: [{ payoutId: null }, { payout: { payoutRun: { status: { notIn: ["DRAFT"] } } } }] }) }, select: { id: true } });
    if (!adj) return { ok: false, code: "not_found", error: "That statement line was not found." };
  } else {
    const acc = await db.commissionAccrual.findFirst({ where: { id: input.lineRef, partnerProfileId: input.partnerId, status: { not: "REVERSED" } }, select: { id: true, accrualDate: true, revenueEvent: { select: { clientId: true } } } });
    if (!acc) return { ok: false, code: "not_found", error: "That statement line was not found." };
    clientId = acc.revenueEvent.clientId;
  }
  // A task belongs to a customer record. A line with no customer (or an override line) borrows one of the partner's own customers.
  if (!clientId) {
    const account = await db.tradingAccount.findFirst({ where: { sourcingPartnerId: input.partnerId }, orderBy: { createdAt: "asc" }, select: { clientId: true } });
    clientId = account?.clientId ?? null;
  }
  if (!clientId) return { ok: false, code: "no_client", error: "A query cannot be filed on this line yet because the partner has no customer record to attach it to. Please contact Finance directly." };

  const open = await db.partnerStatementQuery.findFirst({ where: { raisedById: actor.id, lineRef: input.lineRef, partnerProfileId: input.partnerId }, orderBy: { createdAt: "desc" }, select: { id: true, taskId: true } });
  if (open?.taskId && (await db.task.findFirst({ where: { id: open.taskId, status: { in: ["PENDING", "OVERDUE"] } }, select: { id: true } }))) return { ok: true, queryId: open.id, taskId: open.taskId, duplicate: true };

  const settings = readSettings(await db.partnerWorkspaceSetting.findMany());
  const configured = settings.queries.assigneeUserId ? await db.user.findUnique({ where: { id: settings.queries.assigneeUserId }, select: { id: true, role: true, isActive: true } }) : null;
  const [finance, admins] = configured && configured.isActive && (configured.role === "FINANCE" || configured.role === "ADMIN") ? [[], []] : await Promise.all([db.user.findMany({ where: { role: "FINANCE", isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true }, take: 1 }), db.user.findMany({ where: { role: "ADMIN", isActive: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true }, take: 1 })]);
  const assignee = pickAssignee({ configured, finance: finance.map((u) => u.id), admins: admins.map((u) => u.id) });
  if (!assignee) return { ok: false, code: "no_assignee", error: "There is nobody in Finance to receive this query yet. Please contact Finance directly." };

  const periodLabel = period.kind === "month" ? monthLabel(period.month) : period.kind === "fy" || period.kind === "fyc" ? fyLabel(period.fy).split(" (")[0] : period.kind === "run" ? "payout run" : "open accruals";
  const created = await db.$transaction(async (txNever) => {
    const tx = txNever as unknown as QueryDb;
    const query = await tx.partnerStatementQuery.create({ data: { partnerProfileId: input.partnerId, periodKey: input.period, lineRef: input.lineRef, message: msg.message, raisedById: actor.id } });
    // Created directly, not through the stage engine's helper: a Finance query must not become the customer's "next action" for their RM.
    const task = await tx.task.create({ data: { clientId, assignedToId: assignee, title: queryTaskTitle({ partnerCode: partner.partnerCode, periodLabel, message: msg.message }), dueAt: new Date(now.getTime() + DUE_MS), category: "OTHER", source: `partner-query:${query.id}` } });
    await tx.partnerStatementQuery.update({ where: { id: query.id }, data: { taskId: task.id } });
    await tx.auditLog.create({ data: { userId: actor.id, entity: "PartnerProfile", entityId: input.partnerId, action: "partner_statement_query_raised", newValue: { queryId: query.id, taskId: task.id, period: input.period, lineRef: input.lineRef } } });
    return { queryId: query.id, taskId: task.id };
  });
  return { ok: true, queryId: created.queryId, taskId: created.taskId, duplicate: false };
}
