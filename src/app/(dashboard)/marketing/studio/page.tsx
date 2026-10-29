import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Send } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApprovalStatus } from "@/generated/prisma/client";
import { can } from "@/lib/access/policy";
import { requireMarketing } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { CHANNEL_LABEL, type BroadcastChannel } from "@/lib/marketing/broadcast/schema";
import { marketingPageEnabled } from "@/lib/marketing/flags";

export const metadata = { title: "Broadcasts" };
export const dynamic = "force-dynamic";

const STATUS: Record<ApprovalStatus, { label: string; variant: "warning" | "success" | "destructive" | "secondary" }> = {
  PENDING: { label: "Waiting for approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
  EXPIRED: { label: "Expired", variant: "secondary" },
};

const dateIN = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const num = (n: number) => new Intl.NumberFormat("en-IN").format(n);

type Payload = { name?: string; channel?: BroadcastChannel; templateName?: string; consentedRecipients?: number; approximate?: boolean };

/** Campaign Studio's home: every broadcast drafted here and where it is in approval. Nothing on this page sends anything. */
export default async function BroadcastsPage() {
  const session = await requireMarketing("marketing");
  if (!marketingPageEnabled()) notFound();
  const canCreate = can(session.user.role, "marketing", "manage");

  const rows = await prisma.approvalRequest.findMany({
    where: { actionType: "BROADCAST_DRAFT" },
    orderBy: { requestedAt: "desc" },
    take: 50,
    select: { id: true, status: true, payload: true, requestedAt: true, decisionNote: true, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });

  const newButton = canCreate ? (
    <Button render={<Link href="/marketing/studio/new" />}>
      <Plus aria-hidden /> New broadcast
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Broadcasts" description="WhatsApp and SMS broadcasts drafted in Campaign Studio. Each one goes to a colleague for approval; nothing sends from here." actions={newButton} />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed">
          <EmptyState
            icon={Send}
            title="No broadcasts yet"
            description="Pick an audience, an approved template and your wording. It takes about a minute."
            action={canCreate ? { label: "Start a broadcast", href: "/marketing/studio/new" } : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Broadcasts">
          {rows.map((r) => {
            const p = (r.payload ?? {}) as Payload;
            const s = STATUS[r.status];
            return (
              <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name ?? "Untitled broadcast"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {CHANNEL_LABEL[p.channel ?? "whatsapp"]} · {p.templateName ?? "template"} · by {r.requestedBy.name ?? "a colleague"}, {dateIN(r.requestedAt)}
                    {r.decidedBy?.name ? ` · decided by ${r.decidedBy.name}` : ""}
                  </p>
                  {r.status === "REJECTED" && r.decisionNote && <p className="mt-1 text-xs text-destructive">&ldquo;{r.decisionNote}&rdquo;</p>}
                </div>
                <p className="text-sm tabular-nums text-muted-foreground sm:w-40 sm:text-right">
                  {typeof p.consentedRecipients === "number" ? `${p.approximate ? "≈ " : ""}${num(p.consentedRecipients)} ${p.consentedRecipients === 1 ? "recipient" : "recipients"}` : "—"}
                </p>
                <Badge variant={s.variant} className="self-start sm:self-center">{s.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
