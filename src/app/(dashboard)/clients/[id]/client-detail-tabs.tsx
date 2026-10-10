"use client";

import type { ReactNode } from "react";
import { AiSummaryCard } from "@/components/ai-summary-card";

import { PhoneSheet, WorkspacePanel, WorkspaceShell, WorkspaceTabs, useUrlTab } from "@/components/workspace";
import { buildClientTabs, CLIENT_TAB_FALLBACK } from "./client-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline, type ActivityWithUser } from "@/components/timeline/activity-timeline";
import { hasContactRecord } from "@/lib/copilot/types";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import type { AuditLog, ErasureRequest, MessageTemplate, Role, Stage, Task } from "@/generated/prisma/client";
import type { SafeUser } from "@/lib/db/safe-user";
import type { PriorityScore, HealthResult } from "@/lib/copilot/scoring";
import type { NextBestAction } from "@/lib/copilot/next-best-action";
import type { CrossSellFlag } from "@/lib/copilot/cross-sell";
import type { MilestoneItem } from "@/lib/copilot/milestones";
import type { MessageSuggestion } from "@/lib/copilot/message-suggestion";
import {
  type FullClient,
  RmContactForm,
  StartDocumentsForm,
  DocumentStatusList,
  SubmitForKycForm,
  KycCompletionForm,
  FundingForm,
  DealerIntroForm,
  MarkOnboardingCompletedCard,
} from "./stage-action-card";
import { ClientActionsPanel } from "./client-actions-panel";
import { ClientCopilotPanel } from "./client-copilot-panel";
import { SendMessagePanel } from "./send-message-panel";
import { ClientTasksPanel } from "./client-tasks-panel";
import { AuditHistoryTab } from "./audit-history-tab";
import { HoldersPanel } from "./holders-panel";
import { KycPipelineCard } from "./kyc-pipeline-card";
import { SupportTicketsCard, isOpenTicket, type SupportTicketView } from "./support-tickets-card";
import type { KycPipelineView } from "@/lib/kyc/view";
import { OpportunitiesPanel, type OpportunityRow } from "./opportunities-panel";
import { ClientSnapshotCards } from "./client-snapshot";
import { TradingActivityCard } from "./trading-activity-card";
import { PaymentsCard } from "./payments-card";
import { IntelligenceCard } from "./intelligence-card";
import type { IntelligenceView } from "@/lib/intelligence/view";
import type { ClientSnapshot, PaymentRow, PaymentTotals, TradeRow } from "@/lib/clients/snapshot";
import { WealthPanel, type HoldingRow, type WealthHealthCheckupData, type SmartAllvestProfileData, type PmsAifHoldingData } from "./wealth-panel";

type TabsClient = Omit<FullClient, "activities"> & { activities: ActivityWithUser[] };

function reachedStage(stages: Stage[], currentSequence: number, thresholdStageName: string): boolean {
  const threshold = stages.find((s) => s.name === thresholdStageName);
  if (!threshold) return false;
  return currentSequence >= threshold.sequence;
}

export function ClientDetailTabs({
  client,
  auditLogs,
  users,
  templates,
  stages,
  canOverride,
  currentUserRole,
  tasks,
  priorityScore,
  healthResult,
  nba,
  crossSellFlags,
  milestones,
  messageSuggestion,
  suggestedFollowUp,
  erasureRequest,
  hasActiveTradingAccount,
  opportunities,
  wealthHoldings,
  wealthCheckup,
  smartAllvestProfile,
  pmsAifHoldings,
  snapshot,
  recentTrades,
  tradesLastSyncedAt,
  payments,
  paymentTotals,
  qualityReviewsByActivityId,
  kycPipeline,
  intelligenceView,
  supportTickets,
  freshdeskConnected,
  freshdeskSyncedIso,
  header,
  rail,
  slots,
}: {
  client: TabsClient;
  auditLogs: (AuditLog & { user: SafeUser })[];
  users: SafeUser[];
  templates: MessageTemplate[];
  stages: Stage[];
  canOverride: boolean;
  currentUserRole: Role;
  tasks: Task[];
  priorityScore: PriorityScore;
  healthResult: HealthResult;
  nba: NextBestAction;
  crossSellFlags: CrossSellFlag[];
  milestones: MilestoneItem[];
  messageSuggestion: MessageSuggestion | null;
  suggestedFollowUp: { title: string; dueAtIso: string };
  erasureRequest: ErasureRequest | null;
  hasActiveTradingAccount: boolean;
  opportunities: OpportunityRow[];
  wealthHoldings: HoldingRow[];
  wealthCheckup: WealthHealthCheckupData;
  smartAllvestProfile: SmartAllvestProfileData;
  pmsAifHoldings: PmsAifHoldingData[];
  snapshot: ClientSnapshot;
  recentTrades: TradeRow[];
  tradesLastSyncedAt: Date | null;
  payments: PaymentRow[];
  paymentTotals: PaymentTotals;
  qualityReviewsByActivityId?: Record<string, { id: string; sentimentLabel: string | null; qualityScore: number | null }>;
  /** KYC pipeline v2 steps; null for clients not yet submitted (or submitted before v2). */
  kycPipeline: KycPipelineView | null;
  intelligenceView: IntelligenceView | null;
  /** Freshdesk tickets linked to this client (webhooks + full-history sync). */
  supportTickets: SupportTicketView[];
  freshdeskConnected: boolean;
  freshdeskSyncedIso: string | null;
  /** The fixed header (identity, chips, actions, stage tracker) and the sticky rail, rendered by the page. */
  header: ReactNode;
  rail: ReactNode;
  /** Server-rendered cards that belong to a tab. `consent` is null when the consent feature is off (no Consent tab). */
  slots: { overview: ReactNode; consent: ReactNode | null; support: ReactNode };
}) {
  const openTicketCount = supportTickets.filter((t) => isOpenTicket(t.status)).length;
  const tabDefs = buildClientTabs({ consent: slots.consent !== null, openTickets: openTicketCount });
  const { tab: activeTab, select: setActiveTab, hrefFor } = useUrlTab(tabDefs.map((t) => t.key), CLIENT_TAB_FALLBACK);

  const stageName = client.currentStage.name;
  const contacted = hasContactRecord(client.activities);
  // client.documents spans every holder (tagged by holderId) so Copilot/NBA/Milestones can read it
  // unfiltered — the First Holder's own section here filters back down to just their documents.
  const firstHolderDocuments = client.documents.filter((d) => !d.holderId);
  const startedDocs = firstHolderDocuments.length > 0;
  const canApproveKyc = currentUserRole === "ADMIN" || currentUserRole === "MANAGER";
  // Where a paid/web lead came from (campaign, ad set, UTM…) — set by lead intake; absent for hand-entered clients.
  const leadAttributionRows = Object.entries((client.leadAttribution ?? {}) as Record<string, unknown>).filter(
    ([key, value]) => typeof value === "string" && value && !["source", "externalId"].includes(key),
  ) as [string, string][];
  const kycAwaitingApproval = stageName === "Submitted for KYC" && client.kycRecord?.status !== "APPROVED";
  const showFunding = reachedStage(stages, client.currentStage.sequence, "KYC completed") || client.fundingRecord;
  const showDealer = reachedStage(stages, client.currentStage.sequence, "Pushed for funds") || client.dealerIntroduction;

  return (
    <WorkspaceShell
      hasRail
      header={header}
      rail={rail}
      tabs={<WorkspaceTabs tabs={tabDefs} active={activeTab} idPrefix="client" label="Client sections" hrefFor={hrefFor} onSelect={setActiveTab} />}
    >
      <WorkspacePanel tab={activeTab} idPrefix="client">
        {activeTab === "overview" && (
          <div className="flex flex-col gap-2 lg:gap-4">
            {slots.overview}
            {kycAwaitingApproval && canApproveKyc && (
              <Card className="border-primary/40 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base">KYC awaiting your approval</CardTitle>
                </CardHeader>
                <CardContent>
                  <KycCompletionForm clientId={client.id} kycRecord={client.kycRecord} canApprove />
                </CardContent>
              </Card>
            )}
            <PhoneSheet name="ai-summary" title="AI summary" summary="Summarise this customer">
              <AiSummaryCard kind="client" subjectId={client.id} label="Summarize this client" />
            </PhoneSheet>
            {intelligenceView && (
              <PhoneSheet name="intelligence" title="Customer intelligence" summary="Who to contact, what to discuss and why">
                <IntelligenceCard clientId={client.id} view={intelligenceView} canPreviewBriefing={currentUserRole === "ADMIN" || currentUserRole === "MANAGER"} />
              </PhoneSheet>
            )}
            <ClientSnapshotCards snapshot={snapshot} onOpenTab={setActiveTab} />
            <PhoneSheet name="details" title="Client details" summary={[client.pan, client.city, client.leadSource].filter(Boolean).join(" · ") || "PAN, city, lead source and notes"}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">PAN</dt>
                    <dd>{client.pan ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">CKYC Reference</dt>
                    <dd>{client.ckycRef ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Region</dt>
                    <dd>{client.region ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Preferred Language</dt>
                    <dd>{client.preferredLanguage ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">City</dt>
                    <dd>{client.city ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">State</dt>
                    <dd>{client.state ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Lead Source</dt>
                    <dd>{client.leadSource ?? "—"}</dd>
                  </div>
                  {leadAttributionRows.length > 0 && (
                    <div className="col-span-full">
                      <dt className="text-xs text-muted-foreground">Campaign attribution</dt>
                      <dd className="mt-1 flex flex-wrap gap-1.5">
                        {leadAttributionRows.map(([key, value]) => (
                          <Badge key={key} variant="outline" className="font-normal">
                            <span className="text-muted-foreground">{key.replace(/_/g, " ")}:</span>&nbsp;{value}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  {client.marketingConsentAt && (
                    <div className="col-span-full">
                      <dt className="text-xs text-muted-foreground">Marketing consent</dt>
                      <dd>
                        Given {formatDateTime(client.marketingConsentAt)}
                        {client.marketingConsentText ? <span className="text-muted-foreground"> — &ldquo;{client.marketingConsentText}&rdquo;</span> : null}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground">Client Type</dt>
                    <dd>{client.clientType ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Investment Category</dt>
                    <dd>{client.investmentCategory ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Product Interest</dt>
                    <dd>{client.productInterest ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Existing Broker</dt>
                    <dd>{client.existingBroker ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Trading Experience</dt>
                    <dd>{client.tradingExperience ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Expected Investment</dt>
                    <dd>{client.expectedInvestment ? `₹${formatNumber(client.expectedInvestment)}` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Referral Source</dt>
                    <dd>{client.referralSource ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Operating Instruction</dt>
                    <dd>{client.operatingInstruction?.replace(/_/g, " ") ?? "—"}</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-xs text-muted-foreground">Notes</dt>
                    <dd className="whitespace-pre-wrap">{client.notes ?? "—"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            </PhoneSheet>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="cursor-pointer" onClick={() => setActiveTab("onboarding")}>
                KYC: {client.kycRecord?.status ?? "Not started"}
              </Badge>
              <Badge variant="outline" className="cursor-pointer" onClick={() => setActiveTab("funding")}>
                Funding: {client.fundingRecord?.status ?? "Not started"}
              </Badge>
              <Badge variant="outline" className="cursor-pointer" onClick={() => setActiveTab("funding")}>
                Dealer: {client.dealerIntroduction?.status ?? "Not started"}
              </Badge>
            </div>
            <PhoneSheet name="actions" title="Actions" summary="Reassign, hold, merge, archive">
              <ClientActionsPanel client={client} users={users} currentUserRole={currentUserRole} stages={stages} erasureRequest={erasureRequest} />
            </PhoneSheet>
            <PhoneSheet name="copilot" title="Co-pilot" summary={nba.label}>
            <ClientCopilotPanel
              clientId={client.id}
              assignedToId={client.assignedToId}
              priority={priorityScore}
              health={healthResult}
              nba={nba}
              crossSell={crossSellFlags}
              milestones={milestones}
              messageSuggestion={messageSuggestion}
              suggestedFollowUp={suggestedFollowUp}
              users={users}
            />
            </PhoneSheet>
            <div>
              <p className="mb-2 text-sm font-semibold">Recent Activity</p>
              <ActivityTimeline activities={client.activities.slice(0, 5)} clientId={client.id} showAddNote={false} qualityReviewsByActivityId={qualityReviewsByActivityId} phoneLimit={2} sheetName="recent-activity" />
              <button
                type="button"
                className="mt-2 text-xs text-primary underline max-lg:hidden"
                onClick={() => setActiveTab("activity")}
              >
                View all activity
              </button>
            </div>
            <p className="px-1 text-xs text-muted-foreground max-lg:hidden">
              Created {formatDateTime(client.createdAt)} by stage engine
            </p>
          </div>
        )}

        {activeTab === "onboarding" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold">Onboarding &amp; KYC</p>
              {client.status === "COMPLETED" ? (
                <p className="text-sm text-muted-foreground">
                  Onboarding completed{client.completedAt ? ` on ${formatDateTime(client.completedAt)}` : ""}.
                </p>
              ) : (
                <>
                  {!contacted && <RmContactForm clientId={client.id} />}
                  {contacted && startedDocs && stageName === "New Lead" && (
                    <SubmitForKycForm clientId={client.id} documents={client.documents} canOverride={canOverride} />
                  )}
                  {contacted && !startedDocs && stageName === "New Lead" && (
                    <p className="text-sm text-muted-foreground">
                      Client contacted — start document collection below before submitting for KYC.
                    </p>
                  )}
                  {(stageName === "Submitted for KYC" || client.kycRecord) && (
                    <KycCompletionForm
                      clientId={client.id}
                      kycRecord={client.kycRecord}
                      canApprove={canApproveKyc}
                      pendingKycSteps={kycPipeline ? kycPipeline.total - kycPipeline.done : 0}
                    />
                  )}
                </>
              )}
            </div>

            {kycPipeline && (
              <PhoneSheet name="kyc-pipeline" title="KYC pipeline" summary={`${kycPipeline.done} of ${kycPipeline.total} steps done`}>
                <KycPipelineCard pipeline={kycPipeline} canDecide={canApproveKyc && client.status !== "COMPLETED"} />
              </PhoneSheet>
            )}

            <PhoneSheet name="documents" title="Documents" summary={startedDocs ? `${firstHolderDocuments.filter((d) => d.status === "VERIFIED").length} of ${firstHolderDocuments.length} verified` : "Not started"}>
              <div className="flex flex-col gap-4 border-t pt-6 max-lg:border-t-0 max-lg:pt-0">
                <p className="text-sm font-semibold">Documents</p>
                {!startedDocs && <StartDocumentsForm clientId={client.id} />}
                {startedDocs && <DocumentStatusList documents={firstHolderDocuments} clientId={client.id} holderId={null} />}
              </div>
            </PhoneSheet>

            <PhoneSheet name="holders" title="Account holders" summary={`${client.accountHolders.length} holder${client.accountHolders.length === 1 ? "" : "s"}`}>
              <HoldersPanel
                clientId={client.id}
                holders={client.accountHolders}
                currentUserRole={currentUserRole}
                hasActiveTradingAccount={hasActiveTradingAccount}
              />
            </PhoneSheet>
          </div>
        )}

        {activeTab === "activity" && (
          <div className="flex flex-col gap-4">
            <PhoneSheet name="send-message" title="Send a message" summary="WhatsApp or SMS, with templates">
              <SendMessagePanel clientId={client.id} templates={templates} />
            </PhoneSheet>
            <ActivityTimeline activities={client.activities} clientId={client.id} showAddNote currentUserRole={currentUserRole} qualityReviewsByActivityId={qualityReviewsByActivityId} phoneLimit={5} />
          </div>
        )}

        {activeTab === "tasks" && (
          <div>
            <ClientTasksPanel client={client} tasks={tasks} users={users} />
          </div>
        )}

        {activeTab === "funding" && (
          <div className="flex flex-col gap-6">
            <PhoneSheet name="funds" title="Funds" summary={client.fundingRecord?.status ? client.fundingRecord.status.replace(/_/g, " ").toLowerCase() : "Not started"}>
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold">Funds</p>
              {showFunding ? (
                <FundingForm clientId={client.id} fundingRecord={client.fundingRecord} />
              ) : (
                <p className="text-sm text-muted-foreground">Not reached yet — client is still in {stageName}.</p>
              )}
            </div>
            </PhoneSheet>

            <div className="border-t pt-6 max-lg:border-t-0 max-lg:pt-0">
              <PaymentsCard payments={payments} totals={paymentTotals} />
            </div>

            <PhoneSheet name="dealer" title="Dealer handoff" summary={client.dealerIntroduction?.status ?? "Not started"}>
            <div className="flex flex-col gap-4 border-t pt-6 max-lg:border-t-0 max-lg:pt-0">
              <p className="text-sm font-semibold">Dealer Handoff</p>
              {showDealer ? (
                <DealerIntroForm
                  clientId={client.id}
                  dealerIntroduction={client.dealerIntroduction}
                  dealerUsers={users.filter((u) => u.role === "DEALER").map((u) => ({ id: u.id, name: u.name }))}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Not reached yet — client is still in {stageName}.</p>
              )}
            </div>
            </PhoneSheet>

            {showDealer && (
              <MarkOnboardingCompletedCard
                clientId={client.id}
                clientStatus={client.status}
                dealerName={client.dealerIntroduction?.dealerName}
              />
            )}
          </div>
        )}

        {activeTab === "opportunities" && (
          <div>
            {client.status === "ACTIVE" || client.status === "COMPLETED" ? (
              <OpportunitiesPanel clientId={client.id} opportunities={opportunities} users={users} defaultOwnerId={client.assignedToId ?? undefined} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Opportunities can be tracked once this client is Active or Completed in onboarding.
              </p>
            )}
          </div>
        )}

        {activeTab === "wealth" && (
          <div className="flex flex-col gap-2 lg:gap-4">
            <TradingActivityCard trades={recentTrades} lastSyncedAt={tradesLastSyncedAt} />
            {client.status === "ACTIVE" || client.status === "COMPLETED" ? (
              <WealthPanel
                clientId={client.id}
                holdings={wealthHoldings}
                checkup={wealthCheckup}
                profile={smartAllvestProfile}
                pmsAifHoldings={pmsAifHoldings}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The Wealth Workspace is available once this client is Active or Completed in onboarding.
              </p>
            )}
          </div>
        )}

        {activeTab === "consent" && slots.consent !== null && <div>{slots.consent}</div>}

        {activeTab === "support" && (
          <div className="flex flex-col gap-4">
            {slots.support}
            <SupportTicketsCard clientId={client.id} tickets={supportTickets} connected={freshdeskConnected} lastSyncedIso={freshdeskSyncedIso} />
          </div>
        )}

        {activeTab === "audit" && (
          <div>
            <AuditHistoryTab logs={auditLogs} users={users} />
          </div>
        )}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
