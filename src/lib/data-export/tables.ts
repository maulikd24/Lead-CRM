// What a full data export contains. Changing this list changes what leaves the building, so it is explicit and guarded:
// scripts/check-export-registry.ts fails if a table that holds client data is neither exported nor excluded below,
// or if an exported table gains a column nobody decided about.

export const EXPORT_SCHEMA_VERSION = 1;

export type ExportTable = {
  /** Postgres table name (= Prisma model name). */
  table: string;
  /** Primary-key column used for keyset paging. */
  pk?: string;
  /** Columns that never leave: credentials and security counters. */
  exclude?: string[];
};

/**
 * Reference tables first (everything else points at them), then the client and its history. The importer does not depend on this
 * order — it sorts by the target database's own foreign keys — but a readable order helps people reading the zip.
 */
export const EXPORT_TABLES: ExportTable[] = [
  // Reference data the client records point at.
  { table: "User", exclude: ["passwordHash", "failedLoginAttempts", "lockedUntil", "mustChangePassword", "sessionsValidFrom"] },
  { table: "Stage" },
  { table: "Product" },
  // The client and everything about them.
  { table: "Client" },
  { table: "AccountHolder" },
  { table: "Document" },
  { table: "KycRecord" },
  { table: "KycStep" },
  { table: "FundingRecord" },
  { table: "DealerIntroduction" },
  { table: "StageHistory" },
  { table: "Exception" },
  { table: "Task" },
  { table: "Activity" },
  { table: "Message" },
  { table: "SupportTicket" },
  { table: "ConversationReview" },
  { table: "ConversationInsight" },
  { table: "InteractionOutcome" },
  { table: "AssetClassAcceptance" },
  { table: "CustomerIntelligence", pk: "clientId" },
  { table: "Opportunity" },
  { table: "OpportunityStageHistory" },
  { table: "WealthHealthCheckup" },
  { table: "SmartAllvestProfile" },
  { table: "PmsAifHolding" },
  { table: "ClientPayment" },
  { table: "Household" },
  { table: "HouseholdMember" },
  { table: "TradingAccount" },
  { table: "Position" },
  { table: "Transaction" },
  { table: "ProductEntitlement" },
  { table: "AdvisoryInteraction" },
  { table: "LeadIntake" },
];

/**
 * Deliberately NOT exported, and why. Shown in the manifest and README so nobody assumes they were included.
 * Columns on exported tables that point at these are set to NULL on import where the column allows it.
 */
export const EXCLUDED_BY_DESIGN: Record<string, string> = {
  AuditLog: "Audit trail — out of the agreed scope (use pg_dump for a complete copy)",
  AuditLogChainHead: "Audit trail internals",
  UserEvent: "User activity log — out of the agreed scope",
  LoginAttempt: "Security log",
  DataAccessLog: "Security log",
  DeviceToken: "Credentials",
  PushToken: "Credentials",
  IntegrationConfig: "Encrypted integration credentials",
  WebhookDelivery: "Operational bookkeeping",
  RateLimitCounter: "Operational bookkeeping",
  DailyJobRun: "Operational bookkeeping",
  SystemHeartbeat: "Operational bookkeeping",
  GoLiveCheck: "Operational bookkeeping",
  Notification: "Transient alerts",
  AiSummary: "Cache — regenerated on demand",
  SegmentMembership: "Derived — recomputed after import",
  DeviceCall: "Dedupe ledger tied to device tokens; the calls themselves are in Activity",
  JourneyRun: "Journey execution state (journey definitions are organisation data)",
  JourneyRunStep: "Journey execution state",
  Journey: "Organisation data",
  MessageTemplate: "Organisation data",
  WhatsAppAccount: "Organisation data and session state",
  RevenueEvent: "Earnings data — out of the agreed scope",
  CommissionPlan: "Earnings data — out of the agreed scope",
  CommissionRule: "Earnings data — out of the agreed scope",
  CommissionSlab: "Earnings data — out of the agreed scope",
  PartnerCommissionAssignment: "Earnings data — out of the agreed scope",
  CommissionAccrual: "Earnings data — out of the agreed scope",
  PayoutRun: "Earnings data — out of the agreed scope",
  Payout: "Earnings data — out of the agreed scope",
  PayoutLine: "Earnings data — out of the agreed scope",
  CommissionAdjustment: "Earnings data — out of the agreed scope",
  Team: "Organisation data",
  Company: "Organisation data",
  PartnerProfile: "Organisation data (contains encrypted PAN/GSTIN)",
  HierarchyAssignment: "Organisation data",
  ApprovalRequest: "Workflow history",
  DataRetentionPolicy: "Organisation data",
  ErasureRequest: "Workflow history",
  AssignmentSettings: "Settings",
  BugReport: "Support data about the tool itself",
  DataExport: "Export requests",
};

export function exportTableNames(): string[] {
  return EXPORT_TABLES.map((t) => t.table);
}
