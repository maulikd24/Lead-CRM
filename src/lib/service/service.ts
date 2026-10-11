import { prisma } from "@/lib/db/prisma";
import { authoriseService, type Viewer } from "@/lib/memory/access";

import type { CommitmentAction, ComplaintAction } from "./rules";
import { acceptSuggestedCommitment, actOnCommitment, actOnComplaint, registerComplaint, registerCommitment, suggestCommitmentsFromInsights, type RegisterComplaint, type RegisterCommitment, type ServiceResult } from "./store";

const NOT_FOUND: ServiceResult = { ok: false, code: "NOT_FOUND", message: "Not found." };

async function canManageClient(viewer: Viewer, clientId: string): Promise<boolean> {
  const a = await authoriseService(viewer, clientId);
  return a.ok && a.canManage;
}

/** Guarded entry points for pages and server actions: authorise against the customer the case belongs to, then call the store. */
export async function registerComplaintAs(viewer: Viewer, input: Omit<RegisterComplaint, "actorId">) {
  if (!(await canManageClient(viewer, input.clientId))) return NOT_FOUND;
  return registerComplaint({ ...input, actorId: viewer.userId });
}

export async function actOnComplaintAs(viewer: Viewer, complaintId: string, action: Omit<ComplaintAction, "actorId"> & Record<string, unknown>) {
  const c = await prisma.complaint.findUnique({ where: { id: complaintId }, select: { clientId: true } });
  if (!c || !(await canManageClient(viewer, c.clientId))) return NOT_FOUND;
  return actOnComplaint(complaintId, { ...action, actorId: viewer.userId } as ComplaintAction);
}

export async function registerCommitmentAs(viewer: Viewer, input: Omit<RegisterCommitment, "actorId">) {
  if (!(await canManageClient(viewer, input.clientId))) return NOT_FOUND;
  return registerCommitment({ ...input, actorId: viewer.userId });
}

export async function actOnCommitmentAs(viewer: Viewer, commitmentId: string, action: Omit<CommitmentAction, "actorId"> & Record<string, unknown>) {
  const c = await prisma.commitment.findUnique({ where: { id: commitmentId }, select: { clientId: true } });
  if (!c || !(await canManageClient(viewer, c.clientId))) return NOT_FOUND;
  return actOnCommitment(commitmentId, { ...action, actorId: viewer.userId } as CommitmentAction);
}

export async function acceptCommitmentAs(viewer: Viewer, commitmentId: string) {
  const c = await prisma.commitment.findUnique({ where: { id: commitmentId }, select: { clientId: true } });
  if (!c || !(await canManageClient(viewer, c.clientId))) return NOT_FOUND;
  return acceptSuggestedCommitment(commitmentId, viewer.userId);
}

export async function suggestCommitmentsAs(viewer: Viewer, clientId: string) {
  if (!(await canManageClient(viewer, clientId))) return null;
  return suggestCommitmentsFromInsights(clientId);
}
