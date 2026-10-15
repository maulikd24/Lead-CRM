import { describe, expect, it } from "vitest";

import {
  type CommitmentRecord,
  type ComplaintRecord,
  detectComplaintSlaBreaches,
  detectFindings,
  detectLateCommitments,
  detectMissedFollowUps,
  uniqueByKey,
} from "./findings";

const NOW = new Date("2026-10-13T10:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

const commitment = (over: Partial<CommitmentRecord> = {}): CommitmentRecord => ({
  id: "c1",
  clientId: "client-1",
  ownerId: "rm-1",
  status: "OPEN",
  dueAt: ago(2),
  keptAt: null,
  confirmedAt: ago(10),
  ...over,
});

const complaint = (over: Partial<ComplaintRecord> = {}): ComplaintRecord => ({
  id: "k1",
  clientId: "client-1",
  ownerId: "ops-1",
  severity: "MEDIUM",
  status: "OPEN",
  slaDueAt: ago(1),
  resolvedAt: null,
  closedAt: null,
  ...over,
});

describe("detectMissedFollowUps", () => {
  it("flags a confirmed, still-open commitment past its due time", () => {
    const [f] = detectMissedFollowUps([commitment()], NOW);
    expect(f).toMatchObject({
      dedupeKey: "COMMITMENT:c1:MISSED_FOLLOW_UP",
      clientId: "client-1",
      subjectUserId: "rm-1",
      source: "COMMITMENT",
      category: "MISSED_FOLLOW_UP",
      severity: "MEDIUM",
      evidenceRef: "commitment:c1",
      detectedAt: NOW,
    });
  });

  it("does not flag a commitment that is not yet due", () => {
    expect(detectMissedFollowUps([commitment({ dueAt: ahead(1) })], NOW)).toEqual([]);
  });

  it("does not flag a commitment due exactly now (overdue must be strictly positive)", () => {
    expect(detectMissedFollowUps([commitment({ dueAt: NOW })], NOW)).toEqual([]);
  });

  it("does not flag a commitment that was kept, broken or cancelled", () => {
    const rows = [
      commitment({ id: "a", status: "KEPT", keptAt: ago(3) }),
      commitment({ id: "b", status: "BROKEN" }),
      commitment({ id: "c", status: "CANCELLED" }),
    ];
    expect(detectMissedFollowUps(rows, NOW)).toEqual([]);
  });

  it("never flags a commitment only suggested by a conversation (not yet confirmed)", () => {
    expect(detectMissedFollowUps([commitment({ confirmedAt: null })], NOW)).toEqual([]);
  });

  it("grades severity by how long it has been overdue: under a day LOW, a day or more MEDIUM, a week or more HIGH", () => {
    const sev = (days: number) => detectMissedFollowUps([commitment({ dueAt: new Date(NOW.getTime() - days * DAY) })], NOW)[0]?.severity;
    expect(sev(0.5)).toBe("LOW");
    expect(sev(1)).toBe("MEDIUM");
    expect(sev(6.9)).toBe("MEDIUM");
    expect(sev(7)).toBe("HIGH");
  });

  it("writes a summary with the number of days and without the commitment text", () => {
    const [f] = detectMissedFollowUps([commitment({ dueAt: ago(9) })], NOW);
    expect(f.summary).toBe("Commitment still open and past due by 9 days.");
  });
});

describe("detectComplaintSlaBreaches", () => {
  it("flags a complaint with no resolution and no close, past its SLA due time", () => {
    const [f] = detectComplaintSlaBreaches([complaint()], NOW);
    expect(f).toMatchObject({
      dedupeKey: "COMPLAINT:k1:CUSTOMER_DISSATISFACTION",
      clientId: "client-1",
      subjectUserId: "ops-1",
      source: "COMPLAINT",
      category: "CUSTOMER_DISSATISFACTION",
      evidenceRef: "complaint:k1",
    });
  });

  it("does not flag a complaint still inside its SLA", () => {
    expect(detectComplaintSlaBreaches([complaint({ slaDueAt: ahead(2) })], NOW)).toEqual([]);
  });

  it("does not flag a resolved, closed or already-resolved-at complaint", () => {
    const rows = [
      complaint({ id: "r", status: "RESOLVED" }),
      complaint({ id: "s", status: "CLOSED" }),
      complaint({ id: "t", status: "IN_PROGRESS", resolvedAt: ago(0.5) }),
      complaint({ id: "u", status: "OPEN", closedAt: ago(0.5) }),
    ];
    expect(detectComplaintSlaBreaches(rows, NOW)).toEqual([]);
  });

  it("flags an in-progress or reopened complaint that is past SLA", () => {
    const rows = [complaint({ id: "p", status: "IN_PROGRESS" }), complaint({ id: "q", status: "REOPENED" })];
    expect(detectComplaintSlaBreaches(rows, NOW).map((f) => f.evidenceRef)).toEqual(["complaint:p", "complaint:q"]);
  });

  it("maps the complaint's own severity: CRITICAL and HIGH to HIGH, MEDIUM to MEDIUM, LOW to LOW", () => {
    const sev = (s: ComplaintRecord["severity"]) => detectComplaintSlaBreaches([complaint({ severity: s })], NOW)[0]?.severity;
    expect(sev("CRITICAL")).toBe("HIGH");
    expect(sev("HIGH")).toBe("HIGH");
    expect(sev("MEDIUM")).toBe("MEDIUM");
    expect(sev("LOW")).toBe("LOW");
  });

  it("states the days past SLA, or 'less than a day' inside the first day", () => {
    expect(detectComplaintSlaBreaches([complaint({ slaDueAt: ago(3) })], NOW)[0].summary).toBe("Complaint still open 3 days past its SLA.");
    expect(detectComplaintSlaBreaches([complaint({ slaDueAt: new Date(NOW.getTime() - 3_600_000) })], NOW)[0].summary).toBe(
      "Complaint still open less than a day past its SLA.",
    );
  });
});

describe("detectLateCommitments", () => {
  it("flags a confirmed commitment kept after its due time", () => {
    const [f] = detectLateCommitments([commitment({ status: "KEPT", dueAt: ago(3), keptAt: ago(1) })], NOW);
    expect(f).toMatchObject({
      dedupeKey: "COMMITMENT:c1:COMMITMENT_NOT_COMPLETED",
      category: "COMMITMENT_NOT_COMPLETED",
      severity: "LOW",
      evidenceRef: "commitment:c1",
    });
  });

  it("does not flag a commitment kept on time, or kept at exactly its due time", () => {
    const rows = [
      commitment({ id: "early", status: "KEPT", dueAt: ahead(1), keptAt: NOW }),
      commitment({ id: "exact", status: "KEPT", dueAt: ago(1), keptAt: ago(1) }),
    ];
    expect(detectLateCommitments(rows, NOW)).toEqual([]);
  });

  it("does not flag an open or broken commitment, or a kept one with no keptAt", () => {
    const rows = [
      commitment({ id: "o", status: "OPEN" }),
      commitment({ id: "b", status: "BROKEN", keptAt: ago(1) }),
      commitment({ id: "n", status: "KEPT", dueAt: ago(3), keptAt: null }),
    ];
    expect(detectLateCommitments(rows, NOW)).toEqual([]);
  });

  it("does not flag a late commitment that was never confirmed", () => {
    expect(detectLateCommitments([commitment({ status: "KEPT", dueAt: ago(3), keptAt: ago(1), confirmedAt: null })], NOW)).toEqual([]);
  });
});

describe("detectFindings and the idempotency rule", () => {
  it("runs all three detectors over one batch", () => {
    const out = detectFindings(
      {
        commitments: [commitment(), commitment({ id: "late", status: "KEPT", dueAt: ago(3), keptAt: ago(1) })],
        complaints: [complaint()],
      },
      NOW,
    );
    expect(out.map((f) => f.dedupeKey)).toEqual([
      "COMMITMENT:c1:MISSED_FOLLOW_UP",
      "COMMITMENT:late:COMMITMENT_NOT_COMPLETED",
      "COMPLAINT:k1:CUSTOMER_DISSATISFACTION",
    ].sort());
  });

  it("gives the same keys when the same records are run twice (the key is a function of record and category only)", () => {
    const input = { commitments: [commitment()], complaints: [complaint()] };
    const first = detectFindings(input, NOW).map((f) => f.dedupeKey);
    const second = detectFindings(input, ago(-30)).map((f) => f.dedupeKey);
    expect(second).toEqual(first);
  });

  it("keeps one draft per dedupeKey within a batch, the first one", () => {
    const a = detectMissedFollowUps([commitment()], NOW)[0];
    const b = { ...a, summary: "second" };
    expect(uniqueByKey([a, b])).toEqual([a]);
  });

  it("returns nothing for an empty batch", () => {
    expect(detectFindings({ commitments: [], complaints: [] }, NOW)).toEqual([]);
  });
});
