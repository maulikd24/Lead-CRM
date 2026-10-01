import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { Headphones } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import type { Prisma } from "@/generated/prisma/client";
import { QualityAuditFilters } from "./quality-audit-filters";

type SearchParams = {
  sourceType?: string;
  sentiment?: string;
  status?: string;
  rm?: string;
};

const SENTIMENT_VARIANT: Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>> = {
  positive: "success",
  neutral: "outline",
  mixed: "warning",
  negative: "destructive",
};

function scoreTone(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score < 50) return "text-destructive";
  if (score < 75) return "text-warning";
  return "text-success";
}

export default async function QualityAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireUser();
  const params = await searchParams;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const isAdminOrManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const where: Prisma.ConversationReviewWhereInput = {
    ...(visibleUserIds ? { assignedRmId: { in: visibleUserIds } } : {}),
    ...(params.rm && isAdminOrManager && (!visibleUserIds || visibleUserIds.includes(params.rm)) ? { assignedRmId: params.rm } : {}),
    ...(params.sourceType ? { sourceType: params.sourceType as Prisma.ConversationReviewWhereInput["sourceType"] } : {}),
    ...(params.sentiment ? { sentimentLabel: params.sentiment } : {}),
    ...(params.status === "reviewed" ? { reviewedAt: { not: null } } : {}),
    ...(params.status === "pending_review" ? { reviewedAt: null, status: "ANALYZED" } : {}),
  };

  const [reviews, rms] = await Promise.all([
    prisma.conversationReview.findMany({
      where,
      include: { client: { select: { id: true, name: true, clientCode: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    isAdminOrManager
      ? prisma.user.findMany({
          where: { role: "RM", ...(visibleUserIds ? { id: { in: visibleUserIds } } : {}) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  const rmNameById = new Map(rms.map((r) => [r.id, r.name]));
  // RM filter options need every RM who has a review, not just those with capacity set, so also
  // look up any assignedRmId not already covered by the role-scoped rms list above.
  const uncoveredRmIds = [...new Set(reviews.map((r) => r.assignedRmId).filter((id): id is string => !!id && !rmNameById.has(id)))];
  if (uncoveredRmIds.length > 0) {
    const extra = await prisma.user.findMany({ where: { id: { in: uncoveredRmIds } }, select: { id: true, name: true } });
    for (const u of extra) rmNameById.set(u.id, u.name);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quality Audit"
        description="Sentiment and quality scoring for calls and WhatsApp conversations, with AI-generated follow-up recommendations."
      />

      {isAdminOrManager && <QualityAuditFilters rms={rms} />}

      <Card>
        <CardContent className="p-0">
          {reviews.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Headphones}
                title="No conversations reviewed yet"
                description="Calls are analyzed automatically once Exotel's transcript arrives; WhatsApp threads are swept periodically."
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>RM</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Sentiment</TableHead>
                  <TableHead>Quality Score</TableHead>
                  <TableHead>Review Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell className="text-sm font-medium">
                      <Link href={`/quality-audit/${review.id}`} className="text-primary underline-offset-2 hover:underline">
                        {review.client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{review.client.clientCode}</p>
                    </TableCell>
                    <TableCell className="text-sm">{review.sourceType === "CALL" ? "Call" : "WhatsApp"}</TableCell>
                    <TableCell className="text-sm">{review.assignedRmId ? (rmNameById.get(review.assignedRmId) ?? "—") : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(review.createdAt)}</TableCell>
                    <TableCell>
                      {review.sentimentLabel ? (
                        <Badge variant={SENTIMENT_VARIANT[review.sentimentLabel] ?? "outline"}>{review.sentimentLabel}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {review.status === "PENDING_TRANSCRIPT" ? "Awaiting transcript" : review.status === "FAILED" ? "Failed" : "Analyzing…"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {review.qualityScore !== null ? (
                        <span className={cn("font-heading font-semibold tabular-nums", scoreTone(review.qualityScore))}>{review.qualityScore}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={review.reviewedAt ? "success" : "outline"}>{review.reviewedAt ? "Reviewed" : "Pending Review"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
