import { describe, expect, it } from "vitest";
import { buildEveningBrief, callFactFromPayload, formatTalkTime, summariseCalls, type EveningFacts } from "./evening-brief";

const facts = (over: Partial<EveningFacts> = {}): EveningFacts => ({
  rmName: "Priya Nair",
  dateLabel: "Mon, 12 Oct",
  appUrl: "https://crm.allvest.test/",
  calls: [
    { direction: "outbound", durationSeconds: 120 }, // answered
    { direction: "outbound", durationSeconds: 0 }, // unanswered
    { direction: "inbound", durationSeconds: 300 }, // answered
    { direction: "inbound", durationSeconds: 0 }, // unanswered
    { direction: "missed", durationSeconds: 0 }, // unanswered
  ],
  followUpsDone: 3,
  tasksDone: 4,
  tasksDue: 6,
  newClients: 2,
  stageMoves: 3,
  ...over,
});

describe("evening brief: counting", () => {
  it("counts calls by direction, answered and unanswered, and total talk time", () => {
    expect(summariseCalls(facts().calls)).toEqual({ total: 5, outbound: 2, inbound: 2, missed: 1, answered: 2, unanswered: 3, talkSeconds: 420 });
  });

  it("counts a missed call as unanswered even if it carries a duration", () => {
    expect(summariseCalls([{ direction: "missed", durationSeconds: 40 }])).toMatchObject({ answered: 0, unanswered: 1, talkSeconds: 0 });
  });

  it("reads call payloads the same way the calls screen does", () => {
    expect(callFactFromPayload({ direction: "Outbound", status: "completed", durationSeconds: 184 })).toEqual({ direction: "outbound", durationSeconds: 184 });
    expect(callFactFromPayload({ direction: "INCOMING", durationSeconds: 30 })).toEqual({ direction: "inbound", durationSeconds: 30 });
    expect(callFactFromPayload({ direction: "REJECTED" })).toEqual({ direction: "missed", durationSeconds: 0 });
    expect(callFactFromPayload(null)).toEqual({ direction: "unknown", durationSeconds: 0 });
  });

  it("formats talk time as minutes and seconds, then hours", () => {
    expect(formatTalkTime(420)).toBe("7m 00s");
    expect(formatTalkTime(3725)).toBe("1h 02m");
  });
});

describe("evening brief: content", () => {
  it("subject is the call count, tasks done of due, and the date", () => {
    expect(buildEveningBrief(facts()).subject).toBe("Your evening wrap: 5 calls, 4 of 6 tasks · Mon, 12 Oct");
  });

  it("has four sections with the day's numbers, in the html and the text", () => {
    const { html, text } = buildEveningBrief(facts());
    for (const title of ["Calls", "Follow-ups and tasks", "New clients assigned", "Stage moves"]) {
      expect(html).toContain(title);
      expect(text).toContain(title.toUpperCase());
    }
    expect(text).toContain("- 5 calls today: 2 outbound, 2 inbound");
    expect(text).toContain("- 2 answered, 3 unanswered");
    expect(text).toContain("- Talk time 7m 00s");
    expect(text).toContain("- 3 follow-ups completed");
    expect(text).toContain("- 4 of 6 tasks due today completed");
    expect(text).toContain("- 2 new clients assigned today");
    expect(text).toContain("- 3 clients moved to a new stage");
  });

  it("uses singular forms for one", () => {
    const { text } = buildEveningBrief(facts({ calls: [{ direction: "outbound", durationSeconds: 5 }], followUpsDone: 1, newClients: 1, stageMoves: 1 }));
    expect(text).toContain("- 1 call today: 1 outbound, 0 inbound");
    expect(text).toContain("- 1 follow-up completed");
    expect(text).toContain("- 1 new client assigned today");
    expect(text).toContain("- 1 client moved to a new stage");
  });

  it("links only to the configured CRM base, with no trailing slash doubled", () => {
    const { html, text } = buildEveningBrief(facts());
    expect(html).toContain('href="https://crm.allvest.test/clients"');
    expect(text).toContain("Open: https://crm.allvest.test/clients");
    expect(html).not.toContain("//clients");
  });

  it("puts no personal identifier in the html or the text", () => {
    const { html, text } = buildEveningBrief(facts());
    for (const body of [html, text]) {
      expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/); // email addresses
      expect(body).not.toMatch(/\d{10}/); // phone numbers
      expect(body).not.toMatch(/tel:|wa\.me|\/clients\/[^"\s)]+/); // call and WhatsApp links, client deep links
    }
    // The RM's first name is the greeting only; the body never carries a full name.
    expect(text).toContain("Good evening, Priya.");
    expect(text).not.toContain("Nair");
  });

  it("escapes the RM name in the html", () => {
    expect(buildEveningBrief(facts({ rmName: "<b>Bo</b> Rao" })).html).toContain("Good evening, &lt;b&gt;Bo&lt;/b&gt;.");
  });
});
