/**
 * The rows the ledger reads, as plain data (no Prisma types), so the whole assembly is unit-testable. Each loader in load.ts fills a Bundle from the real tables with
 * bounded, indexed queries; the assembler never touches the database. Only the columns the ledger shows or joins on are carried: never a message body, a draft body,
 * a conversation text, a phone, an email or a PAN.
 */

export type EventRow = {
  id: string; eventId: string; eventType: string; occurredAt: Date; actorType: string; actorId: string | null; clientId: string | null; source: string;
  correlationId: string; causationId: string | null; metadata: unknown; consentContext: unknown;
};
export type DecisionRow = {
  id: string; clientId: string; engineVersion: string; correlationId: string; causationId: string | null; mode: string; result: string; abstainReason: string | null;
  action: string; programme: string; topic: string | null; reason: string; priority: string; channel: string; evidence: unknown; suppression: unknown; policyResult: unknown;
  status: string; observedAt: Date; createdAt: Date;
  feedback: { id: string; userId: string; kind: string; reason: string | null; createdAt: Date }[];
  outcomes: { id: string; kind: string; eventRef: string; occurredAt: Date; daysAfter: number }[];
};
export type RunRow = {
  id: string; createdAt: Date; agentKey: string | null; purposeId: string; status: string; reasonCode: string | null; correlationId: string; causationId: string | null;
  subjectType: string | null; subjectId: string | null; approvalRef: string | null; costUsdEstimate: number; model: string;
};
export type ProposalRow = {
  id: string; agentKey: string; clientId: string; programme: string | null; channel: string; status: string; blockedReason: string | null; decidedById: string | null;
  decidedAt: Date | null; messageId: string | null; createdAt: Date; expiresAt: Date; nbaDecisionId: string | null;
};
export type ApprovalRow = {
  id: string; actionType: string; entity: string; entityId: string; status: string; requestedById: string; requestedAt: Date; decidedById: string | null; decidedAt: Date | null;
  decisionNote: string | null; appliedAt: Date | null; correlationId: string | null; causationId: string | null; autonomyLevel: string | null;
  /** payload.mirror === true: a canonical write-through copy of a legacy approval, not an approval of its own. */
  mirror: { kind: string; subjectId: string } | null;
};
export type AuditRow = { id: string; userId: string; entity: string; entityId: string; action: string; timestamp: Date; newValue: unknown };
export type MessageRow = {
  id: string; clientId: string; channel: string; provider: string; direction: "INBOUND" | "OUTBOUND"; templateId: string | null; status: string; origin: string | null;
  senderUserId: string | null; createdAt: Date; sentAt: Date | null;
};
export type TaskRow = { id: string; clientId: string; assignedToId: string; title: string; dueAt: Date; status: string; category: string; source: string | null; createdAt: Date; updatedAt: Date };
export type ConsentRow = { id: string; clientId: string; purpose: string; channel: string | null; status: string; source: string; capturedAt: Date; capturedById: string | null };
export type ComplaintRow = {
  id: string; clientId: string; severity: string; status: string; ownerId: string | null; sourceType: string; taskId: string | null; insightId: string | null; supportTicketId: string | null;
  openedAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null; closedAt: Date | null; resolutionCode: string | null; createdById: string | null;
  events: { id: string; type: string; actorId: string | null; at: Date }[];
};
export type StageRow = { id: string; clientId: string; fromStage: string | null; toStage: string; changedById: string; changedAt: Date; reason: string | null };

export type Bundle = {
  /** The customer this bundle is about; null for a campaign or a system-wide bundle. */
  clientId: string | null;
  events: EventRow[];
  decisions: DecisionRow[];
  runs: RunRow[];
  proposals: ProposalRow[];
  approvals: ApprovalRow[];
  audits: AuditRow[];
  messages: MessageRow[];
  tasks: TaskRow[];
  consents: ConsentRow[];
  complaints: ComplaintRow[];
  stages: StageRow[];
  /** User id to display name, for every user the rows mention. */
  users: ReadonlyMap<string, string>;
  /** `${agentKey}:${actionType}` to the stored level, when a row exists. */
  autonomy: ReadonlyMap<string, number>;
};

export const emptyBundle = (clientId: string | null = null): Bundle => ({
  clientId, events: [], decisions: [], runs: [], proposals: [], approvals: [], audits: [], messages: [], tasks: [], consents: [], complaints: [], stages: [], users: new Map(), autonomy: new Map(),
});
