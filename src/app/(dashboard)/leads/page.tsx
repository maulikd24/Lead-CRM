import { redirect } from "next/navigation";

import { PipelineBoard } from "@/components/leads/pipeline-board";
import { WorkspaceHeading, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "@/components/workspace";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { buildClientWhere } from "@/lib/clients/build-client-where";
import { prisma } from "@/lib/db/prisma";
import { kanbanEnabled } from "@/lib/leads/kanban-flag";
import { canMoveOwnLeads, canMoveStages, RM_MOVABLE_STAGES, type BoardCard } from "@/lib/leads/kanban-logic";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const BOARD_LIMIT = 200;

function campaignOf(attribution: unknown): string | null {
  if (!attribution || typeof attribution !== "object") return null;
  const a = attribution as Record<string, unknown>;
  const v = a.campaign ?? a.utm_campaign;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null;
}

export default async function LeadsPage() {
  // Dark by default: with the flag off this page does not exist and the Clients list stays the way in.
  if (!kanbanEnabled()) redirect("/clients");
  const session = await requireRole(["ADMIN", "MANAGER", "RM"]);
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  // The same scope as the Clients list, so the board can never show a lead the list would not.
  const where = { ...buildClientWhere({}, visible, { includeUnassigned: session.user.role === "MANAGER" }), status: "ACTIVE" as const };

  const [stages, clients, perStage] = await Promise.all([
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" }, select: { id: true, name: true, sequence: true } }),
    prisma.client.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: BOARD_LIMIT,
      select: { id: true, name: true, clientCode: true, currentStageId: true, priority: true, createdAt: true, leadAttribution: true, assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.client.groupBy({ by: ["currentStageId"], where, _count: { _all: true } }),
  ]);

  // First outreach per lead (the speed-to-lead stop): the earliest note that recorded a contact method.
  const notes = await prisma.activity.findMany({ where: { clientId: { in: clients.map((c) => c.id) }, type: "NOTE" }, select: { clientId: true, createdAt: true, payload: true }, orderBy: { createdAt: "asc" } });
  const firstContact = new Map<string, Date>();
  for (const n of notes) {
    const p = n.payload as { contactMethod?: unknown } | null;
    if (p && typeof p.contactMethod === "string" && !firstContact.has(n.clientId)) firstContact.set(n.clientId, n.createdAt);
  }

  const cards: BoardCard[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.clientCode,
    stageId: c.currentStageId,
    rmId: c.assignedTo?.id ?? null,
    rmName: c.assignedTo?.name ?? null,
    campaign: campaignOf(c.leadAttribution),
    createdAtIso: c.createdAt.toISOString(),
    firstContactAtIso: firstContact.get(c.id)?.toISOString() ?? null,
    priority: c.priority,
  }));
  const totals = Object.fromEntries(perStage.map((g) => [g.currentStageId, g._count._all]));

  // Board and List are two views of the same leads: the tab row is the toggle, and List is the Clients page, unchanged.
  const views = [
    { key: "board", label: "Board", href: "/leads" },
    { key: "list", label: "List", href: "/clients" },
  ];

  return (
    <WorkspaceShell
      header={<WorkspaceHeading title="Leads" description="Your pipeline by stage. Drag a lead, or use the keyboard, to move it." />}
      tabs={<WorkspaceTabs tabs={views} active="board" idPrefix="leads" label="Leads views" />}
    >
      <WorkspacePanel tab="board" idPrefix="leads">
        <PipelineBoard stages={stages} cards={cards} totals={totals} canMove={canMoveStages(session.user.role) || canMoveOwnLeads(session.user.role)} own={canMoveOwnLeads(session.user.role) ? { userId: session.user.id, stageNames: RM_MOVABLE_STAGES } : undefined} />
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
