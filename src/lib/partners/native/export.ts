import type { Role } from "@/generated/prisma/client";
import { statementCsv, statementFilename } from "./csv";
import { longDay } from "./format";
import type { StatementData } from "./queries";
import { buildStatementVM, type Branding } from "./view-models";

export type AuditEntry = {
  userId: string;
  entity: "PartnerProfile";
  entityId: string;
  action: "partner_statement_exported";
  newValue: { format: "csv" | "print"; period: string; lines: number; adjustments: number; role: Role; detail: "full" | "totals" };
};

export type ExportDeps = {
  /** Reads the statement for the caller's scope; null when it does not exist or the caller may not see it. */
  loadStatement: (partnerId: string, run: string) => Promise<StatementData | null>;
  audit: (entry: AuditEntry) => Promise<unknown>;
  /** The letterhead and registration text from Settings. Absent means none. */
  branding?: () => Promise<Branding>;
  now?: () => Date;
};

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const NO_BRANDING: Branding = { letterhead: [], registration: "" };

/**
 * Prepares one statement export (CSV file, or the print version) and records it. The audit entry is written BEFORE
 * anything is handed back, and a failed write fails the export: no data leaves without a record of who took it.
 * The entry holds ids, counts and the format only: no names, amounts, customer codes or bank digits. A viewer who may see
 * totals only gets a file with totals only (no line), and the entry says so.
 */
export async function prepareStatementExport(deps: ExportDeps, input: { userId: string; role: Role; partnerId: string; run: string; format: "csv" | "print" }) {
  const data = await deps.loadStatement(input.partnerId, input.run);
  if (!data) return { kind: "not_found" as const };

  await deps.audit({
    userId: input.userId,
    entity: "PartnerProfile",
    entityId: data.partner.id,
    action: "partner_statement_exported",
    newValue: { format: input.format, period: data.period.key, lines: data.lines.length, adjustments: data.adjustments.length, role: input.role, detail: data.detail },
  });

  const branding = deps.branding ? await deps.branding() : NO_BRANDING;
  const vm = buildStatementVM(data, { all: true }, { branding });
  const at = (deps.now ?? (() => new Date()))();
  return {
    kind: "ok" as const,
    data,
    vm,
    branding,
    filename: statementFilename(data.partner.code, data.period.key),
    csv: statementCsv({
      partnerCode: data.partner.code,
      partnerName: data.partner.name,
      periodLabel: vm.periodLabel,
      runStatus: data.run?.status ?? "OPEN",
      payoutStatus: data.payout?.status ?? "ESTIMATE",
      bankLast4: data.partner.bankLast4,
      statement: vm.statement,
      kindLabel: vm.kindLabel,
      hideLines: vm.detailHidden,
      branding,
      cumulative: vm.cumulative ? { rows: vm.cumulative.raw.rows, totals: vm.cumulative.raw.totals, taxState: vm.cumulative.raw.taxState } : undefined,
    }),
    generatedOn: `${longDay(at)}, ${TIME.format(at)} IST`,
  };
}
