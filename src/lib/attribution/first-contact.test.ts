import { describe, expect, it } from "vitest";

import { firstContactAt, type ContactSignal } from "./first-contact";

const t = (iso: string) => new Date(iso);
const created = t("2027-03-02T05:00:00Z");

describe("firstContactAt: the first time a person of ours actually reached the customer", () => {
  it("counts a connected call, a logged contact or meeting, and an outbound message sent by staff", () => {
    const sigs: ContactSignal[] = [
      { kind: "activity", type: "CALL", at: t("2027-03-02T06:00:00Z"), userId: "rm1", call: { direction: "OUTGOING", durationSeconds: 95 } },
      { kind: "activity", type: "CONTACT", at: t("2027-03-02T07:00:00Z"), userId: "rm1", call: null },
      { kind: "message", direction: "OUTBOUND", at: t("2027-03-02T05:30:00Z"), senderUserId: "rm1", status: "SENT", origin: "crm" },
    ];
    expect(firstContactAt(sigs, created)).toEqual(t("2027-03-02T05:30:00Z"));
    expect(firstContactAt(sigs.slice(0, 2), created)).toEqual(t("2027-03-02T06:00:00Z"));
    expect(firstContactAt([sigs[1]], created)).toEqual(t("2027-03-02T07:00:00Z"));
  });

  it("does not count attempts or automation: missed, rejected or zero-second calls, failed or system messages, customer messages, notes", () => {
    const sigs: ContactSignal[] = [
      { kind: "activity", type: "CALL", at: t("2027-03-02T05:05:00Z"), userId: "rm1", call: { direction: "OUTGOING", durationSeconds: 0 } },
      { kind: "activity", type: "CALL", at: t("2027-03-02T05:06:00Z"), userId: "rm1", call: { direction: "MISSED", durationSeconds: 0 } },
      { kind: "activity", type: "CALL", at: t("2027-03-02T05:07:00Z"), userId: "rm1", call: { direction: "REJECTED", durationSeconds: 12 } },
      { kind: "activity", type: "NOTE", at: t("2027-03-02T05:08:00Z"), userId: "rm1", call: null },
      { kind: "activity", type: "TASK_COMPLETED", at: t("2027-03-02T05:09:00Z"), userId: "rm1", call: null },
      { kind: "activity", type: "CONTACT", at: t("2027-03-02T05:10:00Z"), userId: null, call: null },
      { kind: "message", direction: "INBOUND", at: t("2027-03-02T05:11:00Z"), senderUserId: null, status: "READ", origin: "customer" },
      { kind: "message", direction: "OUTBOUND", at: t("2027-03-02T05:12:00Z"), senderUserId: "rm1", status: "FAILED", origin: "crm" },
      { kind: "message", direction: "OUTBOUND", at: t("2027-03-02T05:13:00Z"), senderUserId: null, status: "SENT", origin: null },
    ];
    expect(firstContactAt(sigs, created)).toBeNull();
  });

  it("a manually logged call (no device record) counts; anything before the lead existed is ignored", () => {
    expect(firstContactAt([{ kind: "activity", type: "CALL", at: t("2027-03-02T05:20:00Z"), userId: "rm1", call: null }], created)).toEqual(t("2027-03-02T05:20:00Z"));
    expect(firstContactAt([{ kind: "activity", type: "CALL", at: t("2027-03-01T05:20:00Z"), userId: "rm1", call: null }], created)).toBeNull();
  });

  it("a phone-mirrored outbound message counts even without a CRM sender", () => {
    expect(firstContactAt([{ kind: "message", direction: "OUTBOUND", at: t("2027-03-02T05:40:00Z"), senderUserId: null, status: "SENT", origin: "phone" }], created)).toEqual(t("2027-03-02T05:40:00Z"));
  });
});
