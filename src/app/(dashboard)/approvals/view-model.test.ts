import { describe, expect, it } from "vitest";

import type { InboxItem } from "@/lib/policy/approvals/canonical/service";

import { ageLabel, autonomyChip, detailOf, expiryLabel, filterHref, inboxTabs, kindChips, parseKind, parseTab, rowOf, shortcutAction, STATE_CHIP } from "./view-model";

const NOW = new Date("2027-04-20T12:00:00Z");
const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  ref: "agent-proposal:p1", kind: "agent-proposal", id: "p1", subject: { type: "Customer message", id: "c1", label: "Riya Shah", href: "/clients/c1" }, state: "requested", legacyState: "DRAFT", summary: "Draft whatsapp message to Riya Shah",
  requestedBy: null, requestedAt: new Date("2027-04-20T09:00:00Z"), approver: null, decidedAt: null, decisionReason: null, expiresAt: new Date("2027-04-21T09:00:00Z"), evidence: [], correlationId: "approval:agent-proposal:p1", causationId: null, autonomy: "L4",
  fourEyesAuthorId: null, clientId: "c1", actions: { canApprove: true, canReject: true, inlineApprove: true, needs: [], blocked: null, selfBlocked: false }, ...over,
});

describe("inbox tabs", () => {
  it("shows Awaiting you always, and Your requests only for someone who can make a request", () => {
    expect(inboxTabs({ awaiting: 3, mine: 0, canRequest: false }).map((t) => t.key)).toEqual(["awaiting"]);
    expect(inboxTabs({ awaiting: 3, mine: 2, canRequest: true }).map((t) => t.key)).toEqual(["awaiting", "mine"]);
    expect(inboxTabs({ awaiting: 3, mine: 2, canRequest: true })[0]).toMatchObject({ label: "Awaiting you", count: 3 });
  });
  it("falls back to the first tab for anything unknown", () => {
    expect(parseTab(undefined, true)).toBe("awaiting");
    expect(parseTab("mine", true)).toBe("mine");
    expect(parseTab("mine", false)).toBe("awaiting");
    expect(parseTab(["mine"], true)).toBe("mine");
    expect(parseTab("nonsense", true)).toBe("awaiting");
  });
});

describe("kind filter", () => {
  it("accepts only kinds the person can see", () => {
    expect(parseKind("agent-proposal", ["agent-proposal", "merge-suggestion"])).toBe("agent-proposal");
    expect(parseKind("payout-run", ["agent-proposal"])).toBeUndefined();
    expect(parseKind(["agent-proposal"], ["agent-proposal"])).toBe("agent-proposal");
    expect(parseKind("<script>", ["agent-proposal"])).toBeUndefined();
  });
  it("builds chips with counts, All first, kinds with nothing waiting left out, and keeps the tab in the link", () => {
    const chips = kindChips({ "agent-proposal": 2, "merge-suggestion": 1 }, "merge-suggestion", "awaiting");
    expect(chips.map((c) => [c.label, c.count, c.active])).toEqual([["All", 3, false], ["Agent draft message", 2, false], ["Duplicate customer merge", 1, true]]);
    expect(chips[1].href).toBe("/approvals?kind=agent-proposal");
    expect(chips[0].href).toBe("/approvals");
    expect(filterHref("mine", "social-post")).toBe("/approvals?tab=mine&kind=social-post");
  });
});

describe("rows and labels", () => {
  it("ages in words and says when something is overdue for attention", () => {
    expect(ageLabel(new Date("2027-04-20T11:59:30Z"), NOW)).toBe("just now");
    expect(ageLabel(new Date("2027-04-20T11:30:00Z"), NOW)).toBe("30 min ago");
    expect(ageLabel(new Date("2027-04-20T09:00:00Z"), NOW)).toBe("3 h ago");
    expect(ageLabel(new Date("2027-04-17T12:00:00Z"), NOW)).toBe("3 days ago");
  });
  it("says when a request lapses", () => {
    expect(expiryLabel(new Date("2027-04-20T14:00:00Z"), NOW)).toBe("Expires in 2 h");
    expect(expiryLabel(new Date("2027-04-21T12:00:00Z"), NOW)).toBe("Expires in 1 day");
    expect(expiryLabel(new Date("2027-04-20T11:00:00Z"), NOW)).toBe("Expired");
    expect(expiryLabel(null, NOW)).toBeNull();
  });
  it("a row has the subject as its title, the kind and age as its meta", () => {
    const r = rowOf(item(), NOW);
    expect(r).toMatchObject({ id: "agent-proposal:p1", title: "Riya Shah", meta: "Agent draft message · 3 h ago" });
  });
  it("does not say the same thing twice when the title already is the kind", () => {
    const generic = item({ kind: "erasure-request", subject: { type: "Erasure request", id: "e", label: "Data erasure request", href: null } });
    expect(rowOf(generic, NOW).meta).toBe("3 h ago");
    expect(detailOf(generic, NOW, false).kindLabel).toBe("");
    expect(detailOf(item(), NOW, false).kindLabel).toBe("Agent draft message");
  });
  it("autonomy reads in plain words: a draft, or something that runs only after approval", () => {
    expect(autonomyChip("L3")).toBe("Draft only");
    expect(autonomyChip("L4")).toBe("Runs after you approve");
    expect(autonomyChip("L2")).toBeNull();
  });
  it("every canonical state has a chip", () => {
    for (const s of ["requested", "approved", "rejected", "expired", "executed", "failed", "cancelled"] as const) expect(STATE_CHIP[s].label.length).toBeGreaterThan(0);
  });
});

describe("keyboard shortcuts", () => {
  const press = (key: string, over: Partial<{ typing: boolean; meta: boolean; canApprove: boolean; inline: boolean; ready: boolean; hasLink: boolean }> = {}) => shortcutAction({ key, typing: false, meta: false, canApprove: true, inline: true, ready: true, hasLink: true, ...over });
  it("a approves, r goes to the reason, o opens the subject", () => {
    expect(press("a")).toBe("approve");
    expect(press("A")).toBe("approve");
    expect(press("r")).toBe("reason");
    expect(press("o")).toBe("open");
  });
  it("never fires while typing or with a modifier key held", () => {
    for (const k of ["a", "r", "o"]) {
      expect(press(k, { typing: true })).toBeNull();
      expect(press(k, { meta: true })).toBeNull();
    }
  });
  it("a only approves what can be approved in place and is ready (ticks done); otherwise it opens the item", () => {
    expect(press("a", { canApprove: false })).toBeNull();
    expect(press("a", { ready: false })).toBeNull();
    expect(press("a", { inline: false })).toBe("open");
    expect(press("o", { hasLink: false })).toBeNull();
    expect(press("x")).toBeNull();
  });
});

describe("detail for the screen", () => {
  it("is plain, serialisable data: dates become words, nothing but what the screen shows", () => {
    const d = detailOf(item({ requestedBy: { id: "m", name: "Maya" }, evidence: [{ key: "draft", label: "Draft message", value: "Hi" }] }), NOW, false);
    expect(d).toMatchObject({
      ref: "agent-proposal:p1", kindLabel: "Agent draft message", title: "Riya Shah", stateLabel: "Waiting", href: "/clients/c1", hrefLabel: "Open customer", autonomy: "Runs after you approve", readOnly: false,
      evidence: [{ key: "draft", label: "Draft message", value: "Hi" }],
    });
    expect(d.meta).toEqual(["Requested by Maya, 3 h ago", "Expires in 21 h"]);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
  it("names the approver and the reason once decided, and has no expiry line for a decided item", () => {
    const d = detailOf(item({ state: "rejected", approver: { id: "a", name: "Asha" }, decidedAt: new Date("2027-04-20T11:00:00Z"), decisionReason: "Too pushy", expiresAt: new Date("2027-04-21T09:00:00Z") }), NOW, true);
    expect(d.meta).toEqual(["Rejected by Asha, 1 h ago"]);
    expect(d.decisionReason).toBe("Too pushy");
    expect(d.readOnly).toBe(true);
  });
  it("says system when an agent or a job asked, and labels the link by what it opens", () => {
    expect(detailOf(item(), NOW, false).meta[0]).toBe("Requested by the system, 3 h ago");
    expect(detailOf(item({ kind: "payout-run", subject: { type: "Payout run", id: "r", label: "Payout run", href: "/earnings/runs/r" } }), NOW, false).hrefLabel).toBe("Open payout run");
    expect(detailOf(item({ subject: { type: "Customer message", id: "c", label: "x", href: null } }), NOW, false).href).toBeNull();
  });
  it("shows the actions the service allowed, nothing more", () => {
    const d = detailOf(item({ actions: { canApprove: false, canReject: true, inlineApprove: true, needs: ["confirmed"], blocked: "Someone else has to approve this.", selfBlocked: false } }), NOW, false);
    expect(d.actions).toEqual({ canApprove: false, canReject: true, inlineApprove: true, needs: ["confirmed"], blocked: "Someone else has to approve this." });
  });
});
