import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/leads/actions", () => ({ moveLeadStageAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import type { BoardCard, BoardStage } from "@/lib/leads/kanban-logic";

import { PipelineBoard } from "./pipeline-board";

const stages: BoardStage[] = [
  { id: "s1", name: "New Lead", sequence: 1 },
  { id: "s2", name: "Submitted for KYC", sequence: 2 },
];
const cards: BoardCard[] = [
  { id: "a", name: "Riya Shah", code: "C-001", stageId: "s1", rmId: "u1", rmName: "Asha Rao", campaign: "Diwali SIP", createdAtIso: "2026-10-11T05:00:00.000Z", firstContactAtIso: null, priority: "HIGH" },
  { id: "b", name: "Kabir Mehta", code: "C-002", stageId: "s2", rmId: null, rmName: null, campaign: null, createdAtIso: "2026-10-10T05:00:00.000Z", firstContactAtIso: null, priority: "MEDIUM" },
];

describe("PipelineBoard", () => {
  const out = renderToStaticMarkup(<PipelineBoard stages={stages} cards={cards} totals={{ s1: 1, s2: 4 }} canMove />);
  it("has one labelled column per stage with the real total", () => {
    expect(out).toContain("New Lead");
    expect(out).toContain("Submitted for KYC");
    expect(out).toContain('aria-label="4 leads"');
  });
  it("shows each card with its RM avatar and campaign chip", () => {
    expect(out).toContain("Riya Shah");
    expect(out).toContain("AR");
    expect(out).toContain("Diwali SIP");
    expect(out).toContain("RM Asha Rao");
    expect(out).toContain("Unassigned");
  });
  it("offers a keyboard drag and a Move to select for someone who may move a stage", () => {
    expect(out).toContain('draggable="true"');
    expect(out).toContain("Press Space to pick up");
    expect(out).toContain("Move Riya Shah to stage");
  });
  it("has a polite live region for announcements", () => {
    expect(out).toMatch(/role="status"[^>]*aria-live="polite"/);
  });
  it("is read-only for everyone else, and says why", () => {
    const ro = renderToStaticMarkup(<PipelineBoard stages={stages} cards={cards} totals={{}} canMove={false} />);
    expect(ro).not.toContain('draggable="true"');
    expect(ro).not.toContain("Move Riya Shah to stage");
    expect(ro).toContain("only managers and admins can move one by hand");
  });
  it("links an overflowing column to the list", () => {
    const many = renderToStaticMarkup(<PipelineBoard stages={stages} cards={cards} totals={{ s1: 90 }} canMove />);
    expect(many).toContain("89 more in the list");
    expect(many).toContain("/clients?stage=s1");
  });
});
