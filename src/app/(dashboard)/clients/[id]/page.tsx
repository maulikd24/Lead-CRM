import { Suspense } from "react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { canViewClient } from "@/lib/clients/access";
import { customer360Enabled } from "@/lib/c360/flag";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/workspace";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BlockerBadge } from "@/components/blocker-badge";
import { StageTracker } from "@/components/stage-tracker";
import { ClientDetailTabs } from "./client-detail-tabs";
import { ClientRail } from "./client-rail";
import { DecisionPanel } from "./decision-panel";
import { JourneyCard } from "./journey-card";
import { buildClientTabs } from "./client-tabs";
import { ContactValue } from "./contact-reveal";
import { SendMessageButton } from "./send-message-button";
import { isOpenTicket } from "@/lib/support/ticket-status";
import { ConsentPanel } from "./consent-panel";
import { canChangeConsent } from "@/lib/consent/change";
import { EditClientDialog } from "./edit-client-dialog";
import { computeSlaStatus, isReferralLeadSource, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { nextStepLabelForViewer } from "../next-step-label";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { computePriorityScore, computeHealthStatus } from "@/lib/copilot/scoring";
import { getNextBestAction } from "@/lib/copilot/next-best-action";
import { getCrossSellFlags } from "@/lib/copilot/cross-sell";
import { getMilestoneChecklist } from "@/lib/copilot/milestones";
import { suggestMessageTemplate } from "@/lib/copilot/message-suggestion";
import { initials } from "@/lib/utils";
import { CLIENT_STATUS_VARIANT as STATUS_VARIANT, PRIORITY_VARIANT } from "@/lib/status-badge-config";
import { computeFundsSnapshot, type PaymentRow, type PaymentTotals } from "@/lib/clients/snapshot";
import { maskContactFields, maskContactInJson, toBrowserContact } from "@/lib/privacy/contact-mask";
import { canRevealContact } from "@/lib/privacy/contact-reveal";
import { stageLabel } from "@/lib/stage-engine/stage-label";
import type { CopilotClient } from "@/lib/copilot/types";
import { loadKycSteps } from "@/lib/kyc/pipeline";
import { getFreshdeskTicketSource } from "@/lib/support/freshdesk-sync";
import { getIntelligenceView } from "@/lib/intelligence/view";
import { getKycProvider } from "@/lib/kyc/providers";
import { buildKycPipelineView } from "@/lib/kyc/view";
import { HandoffTicketsSection } from "./handoff-tickets-section";
import { DuplicateHintsSection } from "./duplicate-hints-section";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAccess("clients");
  const { id } = await params;

  const [
    client,
    visibleUserIds,
    users,
    templates,
    stages,
    exceptions,
    auditLogs,
    activeTradingAccountCount,
    opportunities,
    wealthCheckup,
    smartAllvestProfile,
    conversationReviews,
    paymentRows,
    paymentGroups,
    paymentsSync,
    kycSteps,
    supportTicketRows,
    ticketSource,
    intelligenceView,
  ] = await Promise.all([
    prisma.client.findUnique({
      where: { id },
      include: {
        assignedTo: true,
        currentStage: true,
        // Unfiltered — spans the First Holder's and every joint holder's documents (they all share
        // this clientId, tagged by holderId). Copilot/Next-Best-Action/Milestones rely on this
        // staying unfiltered to automatically account for holder documents; UI that should show
        // only the First Holder's own checklist filters client-side (client-detail-tabs.tsx).
        documents: { orderBy: { createdAt: "asc" }, take: 50 },
        kycRecord: true,
        fundingRecord: true,
        dealerIntroduction: true,
        accountHolders: {
          where: { isDeleted: false },
          include: { documents: { orderBy: { createdAt: "asc" } } },
          orderBy: { position: "asc" },
        },
        activities: { include: { user: true }, orderBy: { createdAt: "desc" }, take: 50 },
        tasks: { orderBy: { dueAt: "asc" }, take: 50 },
      },
    }),
    getVisibleUserIds(session.user.id, session.user.role),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.messageTemplate.findMany({ where: { approved: true } }),
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.exception.findMany({
      where: { clientId: id },
      select: { stageId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
    }),
    prisma.auditLog.findMany({
      where: { entity: "Client", entityId: id },
      include: { user: true },
      orderBy: { timestamp: "desc" },
      take: 100,
    }),
    prisma.tradingAccount.count({ where: { clientId: id, status: "ACTIVE" } }),
    prisma.opportunity.findMany({
      where: { clientId: id },
      include: { owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.wealthHealthCheckup.findUnique({ where: { clientId: id } }),
    prisma.smartAllvestProfile.findUnique({ where: { clientId: id } }),
    prisma.conversationReview.findMany({
      where: { clientId: id, sourceType: "CALL", sourceActivityId: { not: null } },
      select: { id: true, sourceActivityId: true, sentimentLabel: true, qualityScore: true },
    }),
    // Back-office payments (imported idempotently — see households/import-actions.ts). Holdings and trades are not loaded here at all: the portfolio card asks for aggregates on demand.
    prisma.clientPayment.findMany({
      where: { clientId: id },
      include: { tradingAccount: { select: { accountNumber: true } } },
      orderBy: { paidAt: "desc" },
      take: 20,
    }),
    prisma.clientPayment.groupBy({ by: ["paymentType"], where: { clientId: id, status: "SUCCESS" }, _sum: { amount: true } }),
    prisma.clientPayment.aggregate({ where: { clientId: id }, _max: { updatedAt: true } }),
    loadKycSteps(id),
    prisma.supportTicket.findMany({ where: { clientId: id }, orderBy: { ticketCreatedAt: "desc" }, take: 200 }),
    getFreshdeskTicketSource({ allowMock: true }).catch(() => null),
    // Recomputes the customer's lifecycle, acceptance and next best action; never lets a failure here break the page.
    getIntelligenceView(id).catch((error) => {
      console.error("Customer intelligence failed for", id, error);
      return null;
    }),
  ]);

  if (!client) notFound();
  // Unassigned leads are open to Admins (visibleUserIds is null) and Managers, who are the ones who assign them.
  if (!canViewClient(session.user.role, visibleUserIds, client)) notFound();

  const canOverride = session.user.role === "ADMIN" || session.user.role === "MANAGER";

  const now = new Date();
  const heldMs = exceptions
    .filter((e) => e.stageId === client.currentStageId)
    .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
  const effectiveEnteredAt = effectiveStageEnteredAt(client.stageEnteredAt, heldMs);
  const slaStatus = isReferralLeadSource(client.leadSource)
    ? "NOT_APPLICABLE"
    : computeSlaStatus(effectiveEnteredAt, client.currentStage.slaHours, now);
  const ageHours = stageAgeHours(effectiveEnteredAt, now);
  const daysSinceLastActivity = client.activities[0]
    ? Math.floor((now.getTime() - client.activities[0].createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((now.getTime() - client.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const overdueTaskCount = client.tasks.filter((t) => t.status === "OVERDUE").length;
  const openException = exceptions.find((e) => e.status === "OPEN");

  const copilotClient: CopilotClient = client;
  const priorityScore = computePriorityScore({
    priority: client.priority,
    slaStatus,
    overdueTaskCount,
    daysSinceLastActivity,
    clientStatus: client.status,
  });
  const healthResult = computeHealthStatus({
    slaStatus,
    stageAgeHours: ageHours,
    benchmarkAvgHours: null,
    daysSinceLastActivity,
  });
  const nba = getNextBestAction(copilotClient);
  // The one next-step value, shared with the clients list. Same access rule as the list.
  const nextStepLabel = nextStepLabelForViewer(copilotClient, session.user.role, visibleUserIds);
  const crossSellFlags = getCrossSellFlags(client);
  const milestones = getMilestoneChecklist(copilotClient, stages);
  const messageSuggestion = suggestMessageTemplate(nba, { ...copilotClient, assignedTo: client.assignedTo }, templates);
  const suggestedFollowUp = { title: nba.label, dueAtIso: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() };

  // Prisma's Decimal fields aren't plain-serializable across the Server->Client Component
  // boundary — convert to plain numbers before passing down to any "use client" component.
  const { mobile: rawMobile, email: rawEmail, ckycRef: rawCkycRef, ...clientRest } = client;
  const serializedClient = {
    // Masked on the server: the browser never receives the raw mobile, email or CKYC reference (nor their normalised key columns).
    ...toBrowserContact({ ...clientRest, mobile: rawMobile, email: rawEmail, ckycRef: rawCkycRef }),
    accountHolders: client.accountHolders.map((h) => toBrowserContact(h)),
    expectedInvestment: client.expectedInvestment ? Number(client.expectedInvestment) : null,
    fundingRecord: client.fundingRecord
      ? { ...client.fundingRecord, amount: client.fundingRecord.amount ? Number(client.fundingRecord.amount) : null }
      : null,
    dealerIntroduction: client.dealerIntroduction
      ? {
          ...client.dealerIntroduction,
          maxOrderValue: client.dealerIntroduction.maxOrderValue ? Number(client.dealerIntroduction.maxOrderValue) : null,
          maxExposureLimit: client.dealerIntroduction.maxExposureLimit
            ? Number(client.dealerIntroduction.maxExposureLimit)
            : null,
        }
      : null,
  };
  const mayReveal = canRevealContact({ id: session.user.id, role: session.user.role }, client);
  const maskedAuditLogs = auditLogs.map((l) => ({ ...l, oldValue: maskContactInJson(l.oldValue) as typeof l.oldValue, newValue: maskContactInJson(l.newValue) as typeof l.newValue }));

  const serializedOpportunities = opportunities.map((o) => ({
    ...o,
    estimatedValue: Number(o.estimatedValue),
    estimatedAum: o.estimatedAum ? Number(o.estimatedAum) : null,
  }));

  const serializedGoals = smartAllvestProfile?.goals ? (smartAllvestProfile.goals as { goal: string }[]) : null;

  const payments: PaymentRow[] = paymentRows.map((p) => ({
    id: p.id,
    paidAt: p.paidAt,
    type: p.paymentType,
    amount: Number(p.amount),
    mode: p.mode,
    referenceNumber: p.referenceNumber,
    status: p.status,
    accountNumber: p.tradingAccount?.accountNumber ?? null,
  }));
  const sumFor = (type: string) => Number(paymentGroups.find((g) => g.paymentType === type)?._sum.amount ?? 0);
  const paymentTotals: PaymentTotals = {
    fundsIn: sumFor("FUNDS_IN"),
    fundsOut: sumFor("FUNDS_OUT"),
    fees: sumFor("FEE"),
    lastSyncedAt: paymentsSync._max.updatedAt,
  };
  const snapshot = { funds: computeFundsSnapshot({ fundingRecord: serializedClient.fundingRecord, paymentTotals }) };

  const editClient = { ...serializedClient, mobileMasked: serializedClient.mobile, emailMasked: serializedClient.email, ckycRefMasked: serializedClient.ckycRef };
  const consentOn = process.env.NEXT_PUBLIC_CONSENT === "1";
  const openTickets = supportTicketRows.filter((t) => isOpenTicket(t.status)).length;
  const tabKeys = buildClientTabs({ consent: consentOn, openTickets }).map((t) => t.key);

  const header = (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div className="flex items-start gap-3">
              <Avatar className="size-11 shrink-0 max-sm:hidden">
                <AvatarFallback className="font-heading text-sm">{initials(client.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">{client.name}</h1>
                  <span className="font-mono text-sm text-muted-foreground">{client.clientCode}</span>
                  {client.investmentCategory && <Badge variant="outline">{client.investmentCategory}</Badge>}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                  <ContactValue clientId={client.id} field="mobile" masked={serializedClient.mobile} canReveal={mayReveal} empty="no phone" />
                  <span aria-hidden>·</span>
                  <ContactValue clientId={client.id} field="email" masked={serializedClient.email} canReveal={mayReveal} empty="no email" />
                  <span aria-hidden>·</span>
                  <span>{client.assignedTo?.name ?? "Unassigned"}</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
              <Badge variant={STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
              <BlockerBadge reason={openException?.reason} />
              <SendMessageButton clientId={client.id} templates={templates} />
              <span className="contents max-lg:hidden">
                {customer360Enabled() && (
                  <Button variant="outline" size="sm" render={<Link href={`/clients/${client.id}/360`} />}>
                    Customer 360
                  </Button>
                )}
                <EditClientDialog client={editClient} canChangeMobileDirectly={session.user.role === "ADMIN"} />
              </span>
            </div>
          </div>
          <StageTracker stages={stages} currentSequence={client.currentStage.sequence} clientStatus={client.status} />
          {nextStepLabel && (
            <p data-testid="next-step" className="text-sm text-muted-foreground">
              Next step: <span className="font-medium text-foreground">{nextStepLabel}</span>
            </p>
          )}
        </CardHeader>
      </Card>

      {/* Phone: the primary actions sit in a thumb-reach bar (laptops keep them in the header above). */}
      <StickyActionBar phoneOnly>
        {customer360Enabled() && (
          <Button variant="outline" size="lg" render={<Link href={`/clients/${client.id}/360`} />}>
            Customer 360
          </Button>
        )}
        <EditClientDialog client={editClient} canChangeMobileDirectly={session.user.role === "ADMIN"} />
      </StickyActionBar>

      {client.isDeleted && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader className="text-sm text-destructive">
            This client is archived{client.deletedAt ? ` (since ${client.deletedAt.toLocaleDateString("en-IN")})` : ""}. It&apos;s
            hidden from the active Clients list and CSV export. Use &ldquo;Restore Client&rdquo; in the Actions panel on the Overview tab to bring it back.
          </CardHeader>
        </Card>
      )}
    </>
  );

  const rail = (
    <ClientRail
      input={{
        ageHours,
        slaStatus,
        openTickets,
        createdAt: client.createdAt,
        daysSinceLastActivity,
      }}
    />
  );

  return (
    <ClientDetailTabs
      header={header}
      rail={rail}
      slots={{
        overview: (
          <>
            <Suspense fallback={null}>
              <DecisionPanel clientId={client.id} viewer={{ id: session.user.id, role: session.user.role }} visibleUserIds={visibleUserIds} />
            </Suspense>
            {/* Renders nothing unless JOURNEYS_ENABLED is on and the viewer may open this customer. Read only. */}
            <Suspense fallback={null}>
              <JourneyCard clientId={client.id} viewer={{ id: session.user.id, role: session.user.role }} />
            </Suspense>
            <DuplicateHintsSection clientId={client.id} actor={{ id: session.user.id, role: session.user.role }} assignedToId={client.assignedToId} />
          </>
        ),
        consent: consentOn ? (
          <ConsentPanel
            clientId={client.id}
            legacyMarketingConsentAt={client.marketingConsentAt}
            canEdit={canChangeConsent({ id: session.user.id, role: session.user.role }, client, visibleUserIds)}
          />
        ) : null,
        support: <HandoffTicketsSection clientId={client.id} />,
      }}
      client={serializedClient}
        auditLogs={maskedAuditLogs}
        users={users}
        stages={stages}
        canOverride={canOverride}
        currentUserRole={session.user.role}
        tasks={client.tasks}
        priorityScore={priorityScore}
        healthResult={healthResult}
        nba={nba}
        crossSellFlags={crossSellFlags}
        milestones={milestones}
        messageSuggestion={messageSuggestion}
        suggestedFollowUp={suggestedFollowUp}
        hasActiveTradingAccount={activeTradingAccountCount > 0}
        opportunities={serializedOpportunities}
        wealthCheckup={wealthCheckup}
        smartAllvestProfile={smartAllvestProfile ? { ...smartAllvestProfile, goals: serializedGoals } : null}
        snapshot={snapshot}
        payments={payments}
        intelligenceView={intelligenceView}
        supportTickets={supportTicketRows.map((t) => ({
          id: t.id,
          externalId: t.externalId,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          channel: t.channel,
          createdIso: t.ticketCreatedAt?.toISOString() ?? null,
          updatedIso: t.ticketUpdatedAt?.toISOString() ?? null,
          url: ticketSource?.ticketUrl(t.externalId) ?? null,
        }))}
        canRevealContact={mayReveal}
        freshdeskConnected={ticketSource !== null}
        freshdeskSyncedIso={client.freshdeskSyncedAt?.toISOString() ?? null}
        kycPipeline={kycSteps.length > 0 ? buildKycPipelineView(kycSteps, { provider: getKycProvider(), userNames: new Map(users.map((u) => [u.id, u.name])) }) : null}
        paymentTotals={paymentTotals}
        qualityReviewsByActivityId={Object.fromEntries(
          conversationReviews.filter((r) => r.sourceActivityId).map((r) => [r.sourceActivityId as string, { id: r.id, sentimentLabel: r.sentimentLabel, qualityScore: r.qualityScore }]),
        )}
    />
  );
}
