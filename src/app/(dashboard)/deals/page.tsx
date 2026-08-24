import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewDealDialog } from "./new-deal-dialog";
import { DealCard } from "./deal-card";
import { formatNumber } from "@/lib/utils/format";

export default async function DealsPage() {
  await requireUser();

  const pipeline = await prisma.pipeline.findFirst({
    include: {
      stages: {
        orderBy: { order: "asc" },
        include: { deals: { include: { lead: true, contact: true }, orderBy: { createdAt: "desc" } } },
      },
    },
  });

  const leads = await prisma.lead.findMany({
    where: { status: { not: "CONVERTED" } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (!pipeline) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent>No pipeline configured yet.</CardContent>
      </Card>
    );
  }

  const stageOptions = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    order: stage.order,
    pipelineId: stage.pipelineId,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{pipeline.name}</h1>
        <NewDealDialog pipelineId={pipeline.id} stages={stageOptions} leads={leads} />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {pipeline.stages.map((stage) => {
          const total = stage.deals.reduce((sum, d) => sum + Number(d.value), 0);
          return (
            <div key={stage.id} className="flex w-72 shrink-0 flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-medium">{stage.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {stage.deals.length} · ₹{formatNumber(total)}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {stage.deals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={{ ...deal, value: Number(deal.value) }}
                    stages={stageOptions}
                  />
                ))}
                {stage.deals.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded-lg">
                    No deals
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
