import { notFound } from "next/navigation";
import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils/format";
import type { VariantProps } from "class-variance-authority";
import { ReviewForm } from "./review-form";

const SENTIMENT_VARIANT: Record<string, NonNullable<VariantProps<typeof badgeVariants>["variant"]>> = {
  positive: "success",
  neutral: "outline",
  mixed: "warning",
  negative: "destructive",
};

export default async function QualityAuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  const { id } = await params;
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const isAdminOrManager = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const review = await prisma.conversationReview.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, clientCode: true, assignedToId: true } },
      reviewedBy: { select: { name: true } },
      task: { select: { id: true, title: true, status: true, dueAt: true } },
    },
  });

  // Out-of-scope and nonexistent ids are indistinguishable to the caller, same convention as
  // every other detail page's IDOR guard in this app.
  if (!review || (visibleUserIds && review.assignedRmId && !visibleUserIds.includes(review.assignedRmId))) {
    notFound();
  }

  const assignedRm = review.assignedRmId ? await prisma.user.findUnique({ where: { id: review.assignedRmId }, select: { name: true } }) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${review.sourceType === "CALL" ? "Call" : "WhatsApp"} with ${review.client.name}`}
        description={`${formatDateTime(review.createdAt)} · ${review.client.clientCode}${assignedRm ? ` · ${assignedRm.name}` : ""}`}
        actions={
          <Link href={`/clients/${review.client.id}`} className="text-sm text-primary underline-offset-2 hover:underline">
            View client →
          </Link>
        }
      />

      {review.status !== "ANALYZED" && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {review.status === "PENDING_TRANSCRIPT" && "Waiting on Exotel's transcript for this call."}
            {review.status === "ANALYZING" && "Analysis in progress…"}
            {review.status === "FAILED" && <span className="text-destructive">Analysis failed: {review.failureReason ?? "Unknown error"}</span>}
          </CardContent>
        </Card>
      )}

      {review.status === "ANALYZED" && (
        <Card>
          <CardHeader>
            <CardTitle>AI Findings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              {review.sentimentLabel && <Badge variant={SENTIMENT_VARIANT[review.sentimentLabel] ?? "outline"}>{review.sentimentLabel}</Badge>}
              <span className="font-heading text-2xl font-semibold tabular-nums">{review.qualityScore}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
              {review.overriddenScore !== null && (
                <span className="text-sm text-muted-foreground">(manager override: {review.overriddenScore})</span>
              )}
            </div>
            {review.sentimentReasoning && <p className="text-sm text-muted-foreground">{review.sentimentReasoning}</p>}

            {Array.isArray(review.qualityBreakdown) && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Criterion</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(review.qualityBreakdown as { criterion: string; score: number; maxScore: number; notes: string }[]).map((c) => (
                    <TableRow key={c.criterion}>
                      <TableCell className="text-sm">{c.criterion}</TableCell>
                      <TableCell className="text-sm">
                        {c.score} / {c.maxScore}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="border-t border-border pt-4">
              <p className="text-sm font-semibold">Recommendation</p>
              <p className="text-sm text-muted-foreground">{review.recommendationText}</p>
              {review.task && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Task created: &quot;{review.task.title}&quot; ({review.task.status}, due {formatDateTime(review.task.dueAt)})
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
            {review.transcript ?? "No transcript available yet."}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Manual Review</CardTitle>
        </CardHeader>
        <CardContent>
          {isAdminOrManager ? (
            <ReviewForm
              reviewId={review.id}
              currentNotes={review.reviewNotes}
              currentOverride={review.overriddenScore}
              reviewedByName={review.reviewedBy?.name ?? null}
              reviewedAt={review.reviewedAt ? review.reviewedAt.toISOString() : null}
            />
          ) : review.reviewedAt ? (
            <div className="text-sm text-muted-foreground">
              <p>
                Reviewed by {review.reviewedBy?.name ?? "—"} on {formatDateTime(review.reviewedAt)}
              </p>
              {review.reviewNotes && <p className="mt-1">{review.reviewNotes}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not yet reviewed by a manager.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
