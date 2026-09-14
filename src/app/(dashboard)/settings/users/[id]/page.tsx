import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { PartnerHierarchyPanel } from "./partner-hierarchy-panel";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      manager: { select: { name: true } },
      partnerProfile: true,
      teamsManaged: { select: { id: true, name: true, type: true } },
    },
  });
  if (!user) notFound();

  const assigneePartnerId = user.partnerProfile?.id;
  const hierarchyAssignments = await prisma.hierarchyAssignment.findMany({
    where: {
      OR: [
        { assigneeUserId: user.id },
        ...(assigneePartnerId ? [{ assigneePartnerId }] : []),
      ],
    },
    include: {
      parentUser: { select: { name: true } },
      parentPartner: { select: { partnerCode: true } },
      team: { select: { name: true } },
    },
    orderBy: { validFrom: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/settings/users" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-3.5" /> Back to Users
      </Link>
      <PageHeader
        title={user.name}
        description={`${user.email} · ${user.role.replace(/_/g, " ")}${user.manager ? ` · Reports to ${user.manager.name}` : ""}`}
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge variant={user.isActive ? "success" : "destructive"}>{user.isActive ? "Active" : "Inactive"}</Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last signed in</p>
            <p>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Manages team</p>
            <p>{user.teamsManaged[0]?.name ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <PartnerHierarchyPanel profile={user.partnerProfile} assignments={hierarchyAssignments} />
    </div>
  );
}
