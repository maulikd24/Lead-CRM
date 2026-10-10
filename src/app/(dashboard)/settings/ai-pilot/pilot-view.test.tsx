import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PILOT_STATEMENT, PILOT_STATEMENT_VERSION } from "@/lib/agents/pilot";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/settings/ai-pilot", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("./actions", () => ({ addPilotUserAction: vi.fn(), recordSignoffAction: vi.fn(), removeAiKeyAction: vi.fn(), removePilotUserAction: vi.fn(), revokeSignoffAction: vi.fn(), saveAiKeyAction: vi.fn() }));

import { PeoplePanel, SignoffPanel, StatusPanel, type PilotViewProps } from "./pilot-view";

const base: PilotViewProps = {
  statementVersion: PILOT_STATEMENT_VERSION,
  statement: [...PILOT_STATEMENT],
  envOn: true,
  agentOn: true,
  missing: ["no_ai_key", "no_signoff"],
  aiKey: null,
  signoff: null,
  users: [],
  candidates: [{ id: "rm1", name: "Ravi Rao", role: "RM" }, { id: "rm2", name: "Rita Roy", role: "RM" }],
};
const props = (over: Partial<PilotViewProps> = {}) => ({ ...base, ...over });
// The three sections are separate panels (tabs on the page); the tests render all three together.
const render = (over: Partial<PilotViewProps> = {}) => {
  const p = props(over);
  return renderToStaticMarkup(<><StatusPanel {...p} /><SignoffPanel statement={p.statement} statementVersion={p.statementVersion} signoff={p.signoff} /><PeoplePanel users={p.users} candidates={p.candidates} /></>);
};

describe("PilotView", () => {
  it("says the pilot is off, why, and that an empty list means nobody", () => {
    const html = render();
    expect(html).toContain("Pilot is off");
    expect(html).toContain("An Admin has not saved an AI provider key");
    expect(html).toContain("Compliance sign-off");
    expect(html).toContain("Nobody is on the list");
  });

  it("asks for the key in a password field that never autofills, and never prints a key", () => {
    const html = render();
    expect(html).toMatch(/type="password"/);
    expect(html).toContain('autoComplete="off"');
    expect(html).not.toContain("sk-");
  });

  it("with a key saved shows only its last four characters, who saved it and when", () => {
    const html = render({ aiKey: { last4: "ab12", savedAt: "11 Oct 2026, 3:30 pm", savedByName: "Asha" }, missing: ["no_signoff"] });
    expect(html).toContain("ending ab12");
    expect(html).toContain("Asha");
    expect(html).toContain("11 Oct 2026");
    expect(html).toContain("Remove key");
  });

  it("shows the exact wording and an unticked box; recording is disabled until ticked", () => {
    const html = render();
    for (const line of PILOT_STATEMENT) expect(html).toContain(line.replace(/'/g, "&#x27;"));
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Record sign-off/);
  });

  it("shows who recorded the sign-off and when, with a way to withdraw it", () => {
    const html = render({ signoff: { byName: "Asha", at: "11 Oct 2026, 4:00 pm" }, missing: ["no_ai_key"] });
    expect(html).toContain("Recorded by Asha");
    expect(html).toContain("11 Oct 2026, 4:00 pm");
    expect(html).toContain("Withdraw sign-off");
  });

  it("lists the people on the pilot with a Remove button each, and offers only people who are not listed", () => {
    const html = render({ users: [{ id: "rm1", name: "Ravi Rao", role: "RM", addedAt: "10 Oct 2026" }], candidates: [{ id: "rm2", name: "Rita Roy", role: "RM" }] });
    expect(html).toContain("Ravi Rao");
    expect(html).toContain("Remove");
    expect(html).toContain("Rita Roy");
    expect(html).not.toContain("Nobody is on the list");
  });

  it("says the pilot is on when nothing is missing, and how many people have it", () => {
    const html = render({ missing: [], users: [{ id: "rm1", name: "Ravi Rao", role: "RM", addedAt: "10 Oct 2026" }], aiKey: { last4: "ab12", savedAt: "x", savedByName: "Asha" }, signoff: { byName: "Asha", at: "y" } });
    expect(html).toContain("Pilot is on");
    expect(html).toContain("1 person");
  });

  it("explains that the environment flag is a separate switch someone else controls", () => {
    expect(render({ envOn: false, agentOn: false, missing: ["agent_off", "no_ai_key", "no_signoff"] })).toContain("WA_ASSIST_ENABLED");
  });
});
