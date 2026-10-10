import { beforeEach, describe, expect, it } from "vitest";

import { FakeStore } from "./fake-store";
import { accrualStates, clawbackStates, statementCandidates, type LedgerKind } from "./ledger";
import type { NewLedgerEntry } from "./store";
import { approveStatement, confirmClawback, markStatementPaid, prepareStatement, waiveClawback } from "./statements";

const preparer = { id: "u-1", role: "ADMIN" };
const approver = { id: "u-2", role: "FINANCE" };
let store: FakeStore;

const row = (key: string, kind: LedgerKind, over: Partial<NewLedgerEntry> = {}): NewLedgerEntry => ({ idempotencyKey: key, kind, referrerId: "R", referralId: "ref", eventType: "KYC_COMPLETE", ruleId: "rule", refEntryId: null, statementId: null, amountPaise: 10000, periodMonth: "2027-01", flags: [], note: null, actorId: null, ...over });
const idOf = (key: string) => store.ledger.find((e) => e.key === key)!.id;

/** A reward that was approved and paid in January, then clawed back in February, plus a clean February accrual. */
async function seedPaidThenClawed(fresh = 50000) {
  await store.appendEntries([row("a-old", "ACCRUED")]);
  const old = idOf("a-old");
  await store.appendEntries([row("ap-old", "APPROVED", { refEntryId: old }), row("pd-old", "PAID_MARKED", { refEntryId: old }), row("cb-old", "CLAWBACK", { refEntryId: old, amountPaise: -10000, periodMonth: "2027-02", flags: ["CLAWBACK_KYC_REVOKED"] })]);
  if (fresh) await store.appendEntries([row("a-new", "ACCRUED", { amountPaise: fresh, periodMonth: "2027-02", eventType: "FIRST_FUNDING" })]);
}

beforeEach(() => {
  store = new FakeStore();
});

describe("a statement with a recovery line", () => {
  it("nets the recovery off the new rewards, is approved by someone else, and the approval and paid markers carry the negative line", async () => {
    await seedPaidThenClawed();
    const prep = await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" });
    expect(prep).toMatchObject({ ok: true, totalPaise: 40000 });
    const id = (prep as { statementId: string }).statementId;
    expect(await approveStatement({ store, actor: approver, statementId: id })).toEqual({ ok: true });
    const approvals = store.ledger.filter((e) => e.kind === "APPROVED" && e.statementId === id);
    expect(approvals.map((e) => e.amountPaise).sort((a, b) => a - b)).toEqual([-10000, 50000]);
    expect(await markStatementPaid({ store, actor: approver, statementId: id, bankReference: "UTR2027021234567" })).toEqual({ ok: true });
    expect(store.ledger.filter((e) => e.kind === "PAID_MARKED" && e.statementId === id)).toHaveLength(2);
    // The recovery is spent: the next statement does not take it again.
    expect(statementCandidates(store.ledger, "R", "2027-03")).toEqual([]);
  });

  it("a waiver between prepare and approve forces a re-prepare (the line is no longer what was prepared)", async () => {
    await seedPaidThenClawed();
    const prep = (await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" })) as { statementId: string };
    expect(await waiveClawback({ store, actor: preparer, referrerId: "R", entryId: idOf("cb-old"), reason: "KYC was re-approved next day" })).toEqual({ ok: true });
    expect(await approveStatement({ store, actor: approver, statementId: prep.statementId })).toMatchObject({ ok: false, error: expect.stringMatching(/prepare the statement again/i) });
    const again = await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" });
    expect(again).toMatchObject({ ok: true, totalPaise: 50000 });
  });

  it("a clawback after a statement was prepared (but before approval) also forces a re-prepare", async () => {
    await store.appendEntries([row("a1", "ACCRUED", { periodMonth: "2027-02" })]);
    const prep = (await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" })) as { statementId: string };
    await store.appendEntries([row("cb1", "CLAWBACK", { refEntryId: idOf("a1"), amountPaise: -10000, periodMonth: "2027-02", flags: ["CLAWBACK_FUNDING_REVERSED"] })]);
    expect(await approveStatement({ store, actor: approver, statementId: prep.statementId })).toMatchObject({ ok: false });
    expect(store.statements[0].status).toBe("PREPARED");
  });

  it("when recoveries outweigh new rewards no statement is prepared and the balance carries forward", async () => {
    await seedPaidThenClawed(4000);
    expect(await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" })).toMatchObject({ ok: false, error: expect.stringMatching(/carries forward/i) });
    await store.appendEntries([row("a-later", "ACCRUED", { amountPaise: 50000, periodMonth: "2027-03" })]);
    expect(await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-03" })).toMatchObject({ ok: true, totalPaise: 44000 });
  });
});

describe("confirm and waive services", () => {
  it("confirming appends one review-cleared entry on the clawback and is idempotent", async () => {
    await seedPaidThenClawed(0);
    const id = idOf("cb-old");
    expect(await confirmClawback({ store, actor: approver, referrerId: "R", entryId: id, note: "Checked the KYC record: revoked" })).toEqual({ ok: true });
    expect(clawbackStates(store.ledger).get(id)).toBe("CONFIRMED");
    expect(await confirmClawback({ store, actor: approver, referrerId: "R", entryId: id, note: "Checked the KYC record: revoked" })).toMatchObject({ ok: false });
    expect(store.ledger.filter((e) => e.kind === "REVIEW_CLEARED")).toHaveLength(1);
  });
  it("waiving appends a positive entry that cancels the clawback and brings the accrual back", async () => {
    await store.appendEntries([row("a1", "ACCRUED")]);
    await store.appendEntries([row("cb1", "CLAWBACK", { refEntryId: idOf("a1"), amountPaise: -10000, periodMonth: "2027-02", flags: ["CLAWBACK_KYC_REVOKED"] })]);
    expect(accrualStates(store.ledger).get(idOf("a1"))).toBe("CLAWED_BACK");
    expect(await waiveClawback({ store, actor: approver, referrerId: "R", entryId: idOf("cb1"), reason: "KYC was re-approved next day" })).toEqual({ ok: true });
    const waiver = store.ledger.find((e) => e.kind === "CLAWBACK_WAIVED")!;
    expect(waiver).toMatchObject({ amountPaise: 10000, refEntryId: idOf("cb1") });
    expect(accrualStates(store.ledger).get(idOf("a1"))).toBe("ACCRUED");
  });
  it("cannot waive a clawback an approved statement already recovered, or one that is not a clawback, or of another referrer", async () => {
    await seedPaidThenClawed();
    const prep = (await prepareStatement({ store, actor: preparer, referrerId: "R", period: "2027-02" })) as { statementId: string };
    await approveStatement({ store, actor: approver, statementId: prep.statementId });
    expect(await waiveClawback({ store, actor: approver, referrerId: "R", entryId: idOf("cb-old"), reason: "Changed my mind" })).toMatchObject({ ok: false, error: expect.stringMatching(/approved statement/i) });
    expect(await waiveClawback({ store, actor: approver, referrerId: "R", entryId: idOf("a-new"), reason: "It is an accrual" })).toMatchObject({ ok: false });
    expect(await waiveClawback({ store, actor: approver, referrerId: "OTHER", entryId: idOf("cb-old"), reason: "Wrong referrer" })).toMatchObject({ ok: false });
  });
  it("roles are checked inside the service", async () => {
    await seedPaidThenClawed(0);
    const id = idOf("cb-old");
    expect(await confirmClawback({ store, actor: { id: "m", role: "MANAGER" }, referrerId: "R", entryId: id, note: "Checked the KYC record" })).toMatchObject({ ok: false });
    expect(await waiveClawback({ store, actor: { id: "m", role: "RM" }, referrerId: "R", entryId: id, reason: "Not my job to waive" })).toMatchObject({ ok: false });
    expect(store.ledger.filter((e) => e.kind === "REVIEW_CLEARED" || e.kind === "CLAWBACK_WAIVED")).toHaveLength(0);
  });
});
