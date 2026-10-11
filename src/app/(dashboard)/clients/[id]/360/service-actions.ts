"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { authoriseService } from "@/lib/memory/access";
import { COMPLAINT_SEVERITIES, type ComplaintSeverityName } from "@/lib/service/rules";
import { serviceStateEnabled } from "@/lib/memory/flag";
import { acceptCommitmentAs, actOnCommitmentAs, actOnComplaintAs, registerComplaintAs, registerCommitmentAs, suggestCommitmentsAs } from "@/lib/service/service";

export type ServiceActionResult = { ok: true; message?: string } | { ok: false; error: string };

const refresh = (clientId: string) => {
  revalidatePath(`/clients/${clientId}/360`);
  revalidatePath("/service");
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const NOT_AVAILABLE: ServiceActionResult = { ok: false, error: "Not available." };
const out = (r: { ok: boolean; message?: string }, ok: string): ServiceActionResult => (r.ok ? { ok: true, message: ok } : { ok: false, error: r.message ?? "Could not save." });

async function viewerFor(clientId: string) {
  const session = await requireAccess("service-state", "manage");
  if (!serviceStateEnabled()) return null;
  const viewer = { userId: session.user.id, role: session.user.role };
  const a = await authoriseService(viewer, String(clientId));
  return a.ok && a.canManage ? viewer : null;
}

async function complaintBelongs(clientId: string, id: string) {
  return (await prisma.complaint.count({ where: { id: String(id), clientId: String(clientId) } })) === 1;
}
async function commitmentBelongs(clientId: string, id: string) {
  return (await prisma.commitment.count({ where: { id: String(id), clientId: String(clientId) } })) === 1;
}

export async function registerComplaintAction(clientId: string, input: { title: string; summary?: string; severity: string; source?: { type: "TICKET" | "INSIGHT" | "CALL"; ref: string } }): Promise<ServiceActionResult> {
  const viewer = await viewerFor(clientId);
  if (!viewer) return NOT_AVAILABLE;
  const severity = (COMPLAINT_SEVERITIES as readonly string[]).includes(input.severity) ? (input.severity as ComplaintSeverityName) : null;
  if (!severity) return { ok: false, error: "Choose how serious it is." };
  const source = input.source && ["TICKET", "INSIGHT", "CALL"].includes(input.source.type) ? { type: input.source.type, ref: String(input.source.ref) } : { type: "MANUAL" as const };
  const r = await registerComplaintAs(viewer, { clientId: String(clientId), title: text(input.title, 200), summary: text(input.summary, 500) || null, severity, source });
  if (r.ok) refresh(clientId);
  return r.ok ? { ok: true, message: "existed" in r && r.existed ? "That complaint was already registered." : "Complaint registered. The clock is running." } : { ok: false, error: r.message };
}

type ComplaintStep =
  | { type: "acknowledge" }
  | { type: "start" }
  | { type: "assign"; ownerId: string }
  | { type: "set_severity"; severity: string }
  | { type: "resolve"; resolutionCode: string; resolution: string }
  | { type: "close" }
  | { type: "reopen"; reason: string };

export async function complaintStepAction(clientId: string, complaintId: string, step: ComplaintStep): Promise<ServiceActionResult> {
  const viewer = await viewerFor(clientId);
  if (!viewer || !(await complaintBelongs(clientId, complaintId))) return NOT_AVAILABLE;
  let action: Record<string, unknown>;
  switch (step.type) {
    case "assign": action = { type: "assign", ownerId: text(step.ownerId, 60) }; break;
    case "set_severity":
      if (!(COMPLAINT_SEVERITIES as readonly string[]).includes(step.severity)) return { ok: false, error: "Choose a severity." };
      action = { type: "set_severity", severity: step.severity };
      break;
    case "resolve": action = { type: "resolve", resolutionCode: text(step.resolutionCode, 40), resolution: text(step.resolution, 500) }; break;
    case "reopen": action = { type: "reopen", reason: text(step.reason, 300) }; break;
    case "acknowledge": case "start": case "close": action = { type: step.type }; break;
    default: return NOT_AVAILABLE;
  }
  const r = await actOnComplaintAs(viewer, String(complaintId), action as Parameters<typeof actOnComplaintAs>[2]);
  if (r.ok) refresh(clientId);
  return out(r, "Updated.");
}

export async function registerCommitmentAction(clientId: string, input: { text: string; dueAt: string; promisedByType?: string }): Promise<ServiceActionResult> {
  const viewer = await viewerFor(clientId);
  if (!viewer) return NOT_AVAILABLE;
  const due = new Date(String(input.dueAt));
  if (Number.isNaN(due.getTime())) return { ok: false, error: "Pick a due date." };
  const by = ["RM", "CRM", "ALLVEST"].includes(String(input.promisedByType)) ? (input.promisedByType as "RM" | "CRM" | "ALLVEST") : "RM";
  const r = await registerCommitmentAs(viewer, { clientId: String(clientId), text: text(input.text, 300), dueAt: due, promisedByType: by, promisedById: viewer.userId });
  if (r.ok) refresh(clientId);
  return out(r, "Promise recorded.");
}

type CommitmentStep = { type: "keep" } | { type: "break"; note: string } | { type: "cancel"; note: string } | { type: "accept" };

export async function commitmentStepAction(clientId: string, commitmentId: string, step: CommitmentStep): Promise<ServiceActionResult> {
  const viewer = await viewerFor(clientId);
  if (!viewer || !(await commitmentBelongs(clientId, commitmentId))) return NOT_AVAILABLE;
  const r =
    step.type === "accept"
      ? await acceptCommitmentAs(viewer, String(commitmentId))
      : await actOnCommitmentAs(viewer, String(commitmentId), step.type === "keep" ? { type: "keep" } : { type: step.type, note: text(step.note, 300) });
  if (r.ok) refresh(clientId);
  return out(r, step.type === "accept" ? "Accepted. It now counts if it runs late." : "Updated.");
}

export async function suggestCommitmentsAction(clientId: string): Promise<ServiceActionResult> {
  const viewer = await viewerFor(clientId);
  if (!viewer) return NOT_AVAILABLE;
  const r = await suggestCommitmentsAs(viewer, String(clientId));
  if (!r) return NOT_AVAILABLE;
  refresh(clientId);
  return { ok: true, message: r.created ? `${r.created} promise${r.created === 1 ? "" : "s"} suggested from conversations. Accept the ones that are real.` : r.skippedNoDueDate ? "Promises were found but none had a due date, so none were added." : "Nothing new." };
}
