"use client";

import { useState } from "react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline, type ActivityWithUser } from "@/components/timeline/activity-timeline";
import { hasContactRecord } from "@/lib/copilot/types";
import { formatDateTime, formatNumber } from "@/lib/utils/format";
import type { AuditLog, ErasureRequest, MessageTemplate, Role, Stage, Task, User } from "@/generated/prisma/client";
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
import { OpportunitiesPanel, type OpportunityRow } from "./opportunities-panel";
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
}: {
  client: TabsClient;
  auditLogs: (AuditLog & { user: User })[];
  users: User[];
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
}) {
  const [activeTab, setActiveTab] = useState("overview");

  const stageName = client.currentStage.name;
  const contacted = hasContactRecord(client.activities);
  // client.documents spans every holder (tagged by holderId) so Copilot/NBA/Milestones can read it
  // unfiltered — the First Holder's own section here filters back down to just their documents.
  const firstHolderDocuments = client.documents.filter((d) => !d.holderId);
  const startedDocs = firstHolderDocuments.length > 0;
  const showFunding = reachedStage(stages, client.currentStage.sequence, "KYC completed") || client.fundingRecord;
  const showDealer = reachedStage(stages, client.currentStage.sequence, "Pushed for funds") || client.dealerIntroduction;

  return (
    <Tabs value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
      <TabsList variant="line" className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="funding">Funds &amp; Dealer</TabsTrigger>
        <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
        <TabsTrigger value="wealth">Wealth</TabsTrigger>
        <TabsTrigger value="audit">Audit History</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
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
        <ClientActionsPanel client={client} users={users} currentUserRole={currentUserRole} stages={stages} erasureRequest={erasureRequest} />
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
        <div>
          <p className="mb-2 text-sm font-semibold">Recent Activity</p>
          <ActivityTimeline activities={client.activities.slice(0, 5)} clientId={client.id} showAddNote={false} />
          <button
            type="button"
            className="mt-2 text-xs text-primary underline"
            onClick={() => setActiveTab("activity")}
          >
            View all activity
          </button>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Created {formatDateTime(client.createdAt)} by stage engine
        </p>
      </TabsContent>

      <TabsContent value="onboarding" className="flex flex-col gap-6 pt-4">
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
                <KycCompletionForm clientId={client.id} kycRecord={client.kycRecord} />
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
          <p className="text-sm font-semibold">Documents</p>
          {!startedDocs && <StartDocumentsForm clientId={client.id} />}
          {startedDocs && <DocumentStatusList documents={firstHolderDocuments} clientId={client.id} holderId={null} />}
        </div>

        <HoldersPanel
          clientId={client.id}
          holders={client.accountHolders}
          currentUserRole={currentUserRole}
          hasActiveTradingAccount={hasActiveTradingAccount}
        />
      </TabsContent>

      <TabsContent value="activity" className="flex flex-col gap-4 pt-4">
        <SendMessagePanel clientId={client.id} templates={templates} />
        <ActivityTimeline activities={client.activities} clientId={client.id} showAddNote />
      </TabsContent>

      <TabsContent value="tasks" className="pt-4">
        <ClientTasksPanel client={client} tasks={tasks} users={users} />
      </TabsContent>

      <TabsContent value="funding" className="flex flex-col gap-6 pt-4">
        <div className="flex flex-col gap-4">
          <p className="text-sm font-semibold">Funds</p>
          {showFunding ? (
            <FundingForm clientId={client.id} fundingRecord={client.fundingRecord} />
          ) : (
            <p className="text-sm text-muted-foreground">Not reached yet — client is still in {stageName}.</p>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t pt-6">
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

        {showDealer && (
          <MarkOnboardingCompletedCard
            clientId={client.id}
            clientStatus={client.status}
            dealerName={client.dealerIntroduction?.dealerName}
          />
        )}
      </TabsContent>

      <TabsContent value="opportunities" className="pt-4">
        {client.status === "ACTIVE" || client.status === "COMPLETED" ? (
          <OpportunitiesPanel clientId={client.id} opportunities={opportunities} users={users} defaultOwnerId={client.assignedToId ?? undefined} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Opportunities can be tracked once this client is Active or Completed in onboarding.
          </p>
        )}
      </TabsContent>

      <TabsContent value="wealth" className="pt-4">
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
      </TabsContent>

      <TabsContent value="audit" className="pt-4">
        <AuditHistoryTab logs={auditLogs} users={users} />
      </TabsContent>
    </Tabs>
  );
}
