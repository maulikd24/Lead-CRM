import { prisma } from "@/lib/db/prisma";
import type { RevenueType } from "@/generated/prisma/client";

// Same "generic batch-feed adapter stand-in" framing as households/import-actions.ts — CSV upload
// today for revenue types with no natural Transaction link (TRAIL_COMMISSION, AMC_PAYOUT, etc.);
// a real back-office feed would use its own sourceSystem value against the same upsert key.
const SOURCE_SYSTEM = "csv_import";
/**
 * Per-row core logic, deliberately not auth-gated itself (so it is not in a "use server" file: a browser must never reach it) — mirrors households/import-actions.ts's
 * importPositionRow() precedent. The TradingAccount must already exist (created during Workstream
 * 2 onboarding/import) — unlike Position/Transaction rows, a revenue row never auto-creates one.
 */
export async function importRevenueEventRow(row: Record<string, string>): Promise<{ status: "created" | "updated"; detail: string }> {
  const accountNumber = row.accountNumber?.trim();
  if (!accountNumber) throw new Error("accountNumber is required");
  const account = await prisma.tradingAccount.findUnique({ where: { accountNumber } });
  if (!account) throw new Error(`No TradingAccount found for accountNumber "${accountNumber}"`);

  const externalRef = row.externalRef?.trim();
  if (!externalRef) throw new Error("externalRef is required");

  const revenueType = (row.revenueType?.trim().toUpperCase() || "OTHER") as RevenueType;

  const grossRevenueAmount = Number(row.grossRevenueAmount);
  if (Number.isNaN(grossRevenueAmount)) throw new Error("Invalid grossRevenueAmount");

  const eventDate = row.eventDate?.trim() ? new Date(row.eventDate.trim()) : null;
  if (!eventDate || Number.isNaN(eventDate.getTime())) throw new Error("Invalid eventDate");

  const existing = await prisma.revenueEvent.findUnique({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
  });

  await prisma.revenueEvent.upsert({
    where: { sourceSystem_externalRef: { sourceSystem: SOURCE_SYSTEM, externalRef } },
    update: { grossRevenueAmount, eventDate },
    create: {
      sourceSystem: SOURCE_SYSTEM,
      externalRef,
      tradingAccountId: account.id,
      clientId: account.clientId,
      revenueType,
      grossRevenueAmount,
      eventDate,
      rawPayload: row,
    },
  });

  return { status: existing ? "updated" : "created", detail: `${account.accountNumber} · ${revenueType}` };
}
