import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { can } from "@/lib/access/policy";

import { approvalKindOf, approvalVisibleTo, hrefFor } from "./scope";

describe("approval visibility per kind (central definitions, default deny)", () => {
  it("an admin sees every kind, including an unknown one", () => {
    expect(approvalVisibleTo("ADMIN", "STAGE_OVERRIDE")).toBe(true);
    expect(approvalVisibleTo("ADMIN", "SOMETHING_NEW")).toBe(true);
  });
  it("an RM sees the canonical agent-draft approval (their own to approve) and nothing about payouts or stage corrections they did not ask for", () => {
    expect(approvalVisibleTo("RM", "AGENT_PROPOSAL")).toBe(true);
    expect(approvalVisibleTo("RM", "PAYOUT_ADJUSTMENT")).toBe(false);
    expect(approvalVisibleTo("RM", "STAGE_OVERRIDE")).toBe(false);
  });
  it("a manager sees the stage corrections they request, not agent drafts they only watch", () => {
    expect(approvalVisibleTo("MANAGER", "STAGE_OVERRIDE")).toBe(true);
    expect(approvalVisibleTo("MANAGER", "AGENT_PROPOSAL")).toBe(false);
  });
  it("marketing sees marketing kinds only", () => {
    expect(approvalVisibleTo("MARKETING", "AUTOPILOT_ACTION")).toBe(true);
    expect(approvalVisibleTo("MARKETING", "SOCIAL_POST")).toBe(true);
    expect(approvalVisibleTo("MARKETING", "PAYOUT_ADJUSTMENT")).toBe(false);
    expect(approvalVisibleTo("MARKETING", "STAGE_OVERRIDE")).toBe(false);
    expect(approvalVisibleTo("MARKETING", "AGENT_PROPOSAL")).toBe(false);
  });
  it("an unknown kind, an unknown role and an empty role are refused", () => {
    expect(approvalVisibleTo("RM", "SOMETHING_NEW")).toBe(false);
    expect(approvalVisibleTo("NOBODY", "STAGE_OVERRIDE")).toBe(false);
    expect(approvalVisibleTo("", "STAGE_OVERRIDE")).toBe(false);
  });
  it("maps native registry keys and write-through names to one kind", () => {
    expect(approvalKindOf("STAGE_OVERRIDE")).toBe("stage-override");
    expect(approvalKindOf("PAYOUT_ADJUSTMENT")).toBe("payout-run");
    expect(approvalKindOf("AGENT_PROPOSAL")).toBe("agent-proposal");
    expect(approvalKindOf("nonsense")).toBeNull();
  });
});

describe("registry areas", () => {
  it("the customer ledger is for the desk only; campaign view for marketing only; investigate for admin only", () => {
    for (const role of ["RM", "MANAGER", "ADMIN"]) expect(can(role, "action-ledger")).toBe(true);
    for (const role of ["MARKETING", "FINANCE", "PARTNER", "DEALER", "TEAM_MANAGER", "AFFILIATE", "DISTRIBUTOR"]) expect(can(role, "action-ledger")).toBe(false);
    expect(can("MARKETING", "action-ledger-campaigns")).toBe(true);
    for (const role of ["RM", "MANAGER", "FINANCE"]) expect(can(role, "action-ledger-campaigns")).toBe(false);
    for (const role of ["RM", "MANAGER", "MARKETING", "FINANCE", "PARTNER"]) expect(can(role, "action-ledger-investigate")).toBe(false);
    expect(can("ADMIN", "action-ledger-investigate")).toBe(true);
  });
});

describe("source links", () => {
  it("marketing is never given a link into a customer screen", () => {
    const href = hrefFor("MARKETING");
    for (const table of ["Message", "AgentProposal", "Complaint", "ConsentRecord", "DecisionRecord", "StageHistory", "AgentRun", "CustomerEvent"]) expect(href(table, "x", "c1")).toBeNull();
  });
  it("an RM opens customer records but never the investigate page", () => {
    const href = hrefFor("RM");
    expect(href("Message", "m", "c1")).toBe("/inbox?client=c1");
    expect(href("Complaint", "x", "c1")).toBe("/clients/c1/360?tab=service");
    expect(href("AgentRun", "r", "c1")).toBeNull();
    expect(href("ApprovalRequest", "a", "c1")).toBe("/approvals");
  });
  it("an admin reaches the investigate page for runs and approvals", () => {
    const href = hrefFor("ADMIN");
    expect(href("AgentRun", "r1", null)).toBe("/settings/control-plane/investigate?by=run&q=r1");
    expect(href("ApprovalRequest", "a1", null)).toBe("/settings/control-plane/investigate?by=approval&q=a1");
  });
});

describe("a read model: nothing is stored for the ledger", () => {
  const dir = join(process.cwd(), "prisma/migrations");
  const mig = readdirSync(dir).find((d) => d.endsWith("_action_ledger_indexes")) ?? "";
  const sql = mig ? readFileSync(join(dir, mig, "migration.sql"), "utf8").replace(/--.*$/gm, "") : "";
  it("the migration is two indexes and nothing else: no table, no column, no foreign key", () => {
    expect(mig).not.toBe("");
    expect(mig >= "20270530000000").toBe(true);
    expect(sql.match(/CREATE INDEX/g)).toHaveLength(2);
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|FOREIGN KEY|ADD COLUMN|DROP |REFERENCES/i);
  });
  it("the schema has no ledger model", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema.match(/^model\s+(ActionLedger|Ledger)\w*/gm)).toBeNull();
  });
});
