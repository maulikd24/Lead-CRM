import { prisma } from "@/lib/db/prisma";

import type { ComplianceIssue } from "./compliance";
import { POST_STATUSES, type PostStatus } from "./workflow";

/** Plain, serialisable views of posts for the pages. */

export type PostView = {
  id: string;
  channel: string;
  title: string | null;
  body: string;
  status: PostStatus;
  source: "STAFF" | "AI";
  scheduledFor: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  createdByName: string | null;
  reviewNote: string | null;
  issues: ComplianceIssue[];
  createdAt: string;
  updatedAt: string;
};

export type PostEventView = { action: string; from: string | null; to: string | null; actorName: string | null; note: string | null; at: string };

type Row = Awaited<ReturnType<typeof prisma.socialPost.findMany>>[number];

function view(row: Row, names: Map<string, string>): PostView {
  return {
    id: row.id,
    channel: row.channel,
    title: row.title,
    body: row.body,
    status: (POST_STATUSES as readonly string[]).includes(row.status) ? (row.status as PostStatus) : "DRAFT",
    source: row.source === "AI" ? "AI" : "STAFF",
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByName: row.approvedById ? (names.get(row.approvedById) ?? null) : null,
    createdByName: names.get(row.createdById) ?? null,
    reviewNote: row.reviewNote,
    issues: Array.isArray(row.complianceIssues) ? (row.complianceIssues as ComplianceIssue[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function loadPosts(): Promise<PostView[]> {
  const rows = await prisma.socialPost.findMany({ orderBy: [{ updatedAt: "desc" }], take: 300 });
  const names = await namesFor(rows.flatMap((r) => [r.createdById, r.approvedById]));
  return rows.map((r) => view(r, names));
}

export async function loadPost(id: string): Promise<{ post: PostView; events: PostEventView[] } | null> {
  const row = await prisma.socialPost.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!row) return null;
  const names = await namesFor([row.createdById, row.approvedById, ...row.events.map((e) => e.actorId)]);
  return {
    post: view(row, names),
    events: row.events.map((e) => ({ action: e.action, from: e.fromStatus, to: e.toStatus, actorName: e.actorId ? (names.get(e.actorId) ?? null) : null, note: e.note, at: e.createdAt.toISOString() })),
  };
}
