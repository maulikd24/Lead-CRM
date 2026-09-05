import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DealerDeskTable } from "./dealer-desk-table";

export default async function DealerDeskPage() {
  const session = await requireRole(["DEALER"]);

  const clients = await prisma.client.findMany({
    where: { dealerIntroduction: { dealerId: session.user.id } },
    include: { dealerIntroduction: true, currentStage: true },
    orderBy: { updatedAt: "desc" },
  });

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down to the "use client" table.
  const serializedClients = clients.map((client) => ({
    ...client,
    expectedInvestment: client.expectedInvestment ? Number(client.expectedInvestment) : null,
    dealerIntroduction: client.dealerIntroduction
      ? {
          ...client.dealerIntroduction,
          maxOrderValue: client.dealerIntroduction.maxOrderValue ? Number(client.dealerIntroduction.maxOrderValue) : null,
          maxExposureLimit: client.dealerIntroduction.maxExposureLimit
            ? Number(client.dealerIntroduction.maxExposureLimit)
            : null,
        }
      : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dealer Desk" description="Clients handed off to you for trading execution." />
      <Card>
        <CardHeader>
          <CardTitle>My Handoffs</CardTitle>
        </CardHeader>
        <CardContent>
          <DealerDeskTable clients={serializedClients} />
        </CardContent>
      </Card>
    </div>
  );
}
