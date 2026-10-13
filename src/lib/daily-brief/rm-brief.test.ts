import { describe, expect, it } from "vitest";
import { buildBrief, NEXT_ACTION, type BriefClient } from "./rm-brief";

const APP = "https://crm.allvest.test";

const client = (over: Partial<BriefClient> = {}): BriefClient => ({
  id: "cl_1",
  name: "Asha Rao",
  phone: "9876543210",
  stage: "New Lead",
  source: "meta",
  slaDueAt: new Date("2026-10-13T06:00:00Z"),
  createdAt: new Date("2026-10-12T10:00:00Z"),
  ...over,
});

const base = { rmName: "Priya Nair", dateLabel: "Tue, 13 Oct", appUrl: APP };

describe("buildBrief", () => {
  it("counts every section and reports the total", () => {
    const r = buildBrief({
      ...base,
      overdue: [client({ id: "a" }), client({ id: "b" })],
      dueToday: [client({ id: "c" })],
      newLeads: [client({ id: "d" })],
    });
    expect(r.total).toBe(4);
    expect(r.html).toContain("Overdue (2)");
    expect(r.html).toContain("Due today (1)");
    expect(r.html).toContain("New leads (last 24h) (1)");
  });

  it("uses the overdue subject when anything is overdue, and the neutral one otherwise", () => {
    const withOverdue = buildBrief({ ...base, overdue: [client()], dueToday: [], newLeads: [] });
    expect(withOverdue.subject).toBe("Your day: 1 clients, 1 overdue · Tue, 13 Oct");
    const none = buildBrief({ ...base, overdue: [], dueToday: [client()], newLeads: [] });
    expect(none.subject).toBe("Your day: 1 clients to move forward · Tue, 13 Oct");
    expect(none.html).toContain("Nothing overdue, so keep the momentum going.");
  });

  it("greets the RM by first name and falls back when the name is blank", () => {
    expect(buildBrief({ ...base, overdue: [], dueToday: [], newLeads: [] }).text).toMatch(/^Good morning, Priya\./);
    expect(buildBrief({ ...base, rmName: "   ", overdue: [], dueToday: [], newLeads: [] }).text).toMatch(/^Good morning, there\./);
  });

  it("builds every client link and the clients link from the configured app URL only", () => {
    const r = buildBrief({
      ...base,
      appUrl: `${APP}/`,
      overdue: [client({ id: "cl_9" })],
      dueToday: [],
      newLeads: [],
    });
    expect(r.html).toContain(`href="${APP}/clients/cl_9"`);
    expect(r.html).toContain(`href="${APP}/clients"`);
    expect(r.text).toContain(`Open: ${APP}/clients`);
    expect(r.html).not.toMatch(/vercel\.app|localhost/);
    expect(r.text).not.toMatch(/vercel\.app|localhost/);
  });

  it("never produces a link to a domain other than the configured one", () => {
    const r = buildBrief({ ...base, overdue: [client()], dueToday: [client({ id: "x" })], newLeads: [client({ id: "y" })] });
    const hrefs = [...r.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const appLinks = hrefs.filter((h) => !h.startsWith("https://wa.me/"));
    expect(appLinks.length).toBeGreaterThan(0);
    for (const h of appLinks) expect(h.startsWith(`${APP}/`)).toBe(true);
  });

  it("escapes client names and RM names so they cannot inject markup", () => {
    const r = buildBrief({
      ...base,
      rmName: "<b>Eve</b>",
      overdue: [client({ name: `<script>alert("x")</script> & co` })],
      dueToday: [],
      newLeads: [],
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(r.html).toContain("Good morning, &lt;b&gt;Eve&lt;/b&gt;.");
  });

  it("shows the SLA due time only for sections that carry one", () => {
    const overdue = buildBrief({ ...base, overdue: [client()], dueToday: [], newLeads: [] });
    expect(overdue.html).toMatch(/due \d{1,2} \w{3}, \d{1,2}:\d{2} (am|pm)/i);
    const newLeads = buildBrief({ ...base, overdue: [], dueToday: [], newLeads: [client()] });
    expect(newLeads.html).not.toMatch(/ · due /);
  });

  it("gives each stage its next action and falls back for unknown stages", () => {
    const r = buildBrief({
      ...base,
      overdue: [],
      dueToday: [],
      newLeads: [client({ stage: "KYC completed" }), client({ id: "u", stage: "Something Else" })],
    });
    expect(r.text).toContain(`- Asha Rao (KYC completed): ${NEXT_ACTION["KYC completed"]}`);
    expect(r.text).toContain("- Asha Rao (Something Else): Follow up");
  });

  it("links to call and WhatsApp only when a phone exists, and turns a 10-digit number into an India WhatsApp link", () => {
    const withPhone = buildBrief({ ...base, overdue: [client({ phone: "98765 43210" })], dueToday: [], newLeads: [] });
    expect(withPhone.html).toContain("https://wa.me/919876543210");
    expect(withPhone.html).toContain('href="tel:98765 43210"');
    const noPhone = buildBrief({ ...base, overdue: [client({ phone: null })], dueToday: [], newLeads: [] });
    expect(noPhone.html).not.toContain("wa.me");
    expect(noPhone.html).not.toContain("tel:");
  });

  it("omits empty sections from the HTML and the plain text", () => {
    const r = buildBrief({ ...base, overdue: [], dueToday: [client()], newLeads: [] });
    expect(r.text).not.toContain("OVERDUE");
    expect(r.text).not.toContain("NEW LEADS");
    expect(r.text).toContain("DUE TODAY");
    expect(r.html).not.toContain("Overdue (");
  });

  it("uses singular grammar for exactly one client", () => {
    const one = buildBrief({ ...base, overdue: [], dueToday: [client()], newLeads: [] });
    expect(one.html).toContain("1 client need you today.");
    const many = buildBrief({ ...base, overdue: [], dueToday: [client(), client({ id: "2" })], newLeads: [] });
    expect(many.html).toContain("2 clients need you today.");
  });
});
