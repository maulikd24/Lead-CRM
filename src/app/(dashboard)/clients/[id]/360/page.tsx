import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { customer360Enabled } from "@/lib/c360/flag";
import { Badge } from "@/components/ui/badge";
import { LeftRail, RightRail, TimelineRail } from "@/components/c360/rails";
import { RailSkeleton, TimelineSkeleton } from "@/components/c360/rail-views";

import "@/components/c360/c360.css";

export const metadata = { title: "Customer 360" };

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  if (!customer360Enabled()) notFound();
  const session = await requireUser();
  const { id } = await params;

  // Same authorisation as the client detail page (canViewClient is the shared rule). Nothing below runs for a
  // client this user may not open, and the rails only ever receive an id that passed this check.
  const [client, visibleUserIds] = await Promise.all([
    prisma.client.findUnique({ where: { id }, select: { id: true, name: true, clientCode: true, assignedToId: true, isDeleted: true, mergedIntoId: true } }),
    getVisibleUserIds(session.user.id, session.user.role),
  ]);
  if (!client || !canViewClient(session.user.role, visibleUserIds, client)) notFound();

  return (
    <div className="c360 flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/clients/${client.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ArrowLeft className="size-4" /> Back to client
          </Link>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight">
            {client.name} <span className="font-mono text-sm font-normal text-muted-foreground">{client.clientCode}</span>
          </h1>
          <p className="text-sm text-muted-foreground">Customer 360: everything we know and everything that happened, in one place.</p>
        </div>
        {client.isDeleted && <Badge variant="destructive">Archived</Badge>}
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
        <aside aria-label="Portfolio and acceptance" className="grid content-start gap-5">
          <Suspense fallback={<RailSkeleton label="portfolio" rows={6} />}>
            <LeftRail clientId={client.id} />
          </Suspense>
        </aside>
        <section className="min-w-0" aria-label="Timeline">
          <Suspense fallback={<TimelineSkeleton />}>
            <TimelineRail clientId={client.id} />
          </Suspense>
        </section>
        <aside aria-label="Next action, commitments and key dates" className="grid content-start gap-5">
          <Suspense fallback={<RailSkeleton label="customer summary" rows={7} />}>
            <RightRail clientId={client.id} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
