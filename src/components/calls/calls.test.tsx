import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CallList } from "./call-list";
import { CallMedia } from "./call-media";
import { FlagChips } from "./flag-chips";
import { CallFiltersForm } from "./call-filters";
import { QualityRing } from "./quality-ring";
import { RollupPanel } from "./rollup-panel";
import { buildCallRow, buildRollup, parseFilters, type CallRecord } from "@/lib/calls/view-model";
import { parseTranscript } from "@/lib/calls/transcript";

const NOW = new Date("2026-10-09T10:00:00Z");
const record = (over: Partial<CallRecord> = {}): CallRecord => ({
  activityId: "a1",
  occurredAt: new Date("2026-10-08T09:00:00Z"),
  payload: { direction: "Outbound", status: "completed", durationSeconds: 184, recordingUrl: "https://recordings.exotel.com/secret-path.mp3", From: "+919876543210" },
  clientId: "c1",
  customerName: "Riya Shah",
  rmId: "rm1",
  rmName: "Asha",
  review: { id: "r1", status: "ANALYZED", hasTranscript: true, qualityScore: 82, overriddenScore: null, sentimentLabel: "positive", reviewedAt: null },
  insights: [{ kind: "COMPLAINT", status: "OPEN", dueAt: null }],
  ...over,
});

describe("QualityRing", () => {
  it("prints the score, labels it for screen readers and draws an arc", () => {
    const html = renderToStaticMarkup(<QualityRing score={82} />);
    expect(html).toContain('aria-label="Quality score 82 out of 100"');
    expect(html).toContain("calls-ring-arc");
    expect(html).toContain("stroke-success");
    expect(html).toContain(">82<");
  });
  it("uses warning and destructive colours for lower bands", () => {
    expect(renderToStaticMarkup(<QualityRing score={60} />)).toContain("stroke-warning");
    expect(renderToStaticMarkup(<QualityRing score={20} />)).toContain("stroke-destructive");
  });
  it("shows a dash and no arc without a score", () => {
    const html = renderToStaticMarkup(<QualityRing score={null} />);
    expect(html).toContain("No quality score yet");
    expect(html).not.toContain("calls-ring-arc");
  });
});

describe("FlagChips", () => {
  it("renders readable labels and nothing when empty", () => {
    const html = renderToStaticMarkup(<FlagChips flags={["compliance", "missed_followup"]} />);
    expect(html).toContain("Compliance concern");
    expect(html).toContain("Missed follow-up");
    expect(renderToStaticMarkup(<FlagChips flags={[]} />)).toBe("");
  });
});

describe("CallList", () => {
  it("renders customer name, RM, flags and indicators but never a phone number or recording URL", () => {
    const rows = [buildCallRow(record(), NOW)];
    const html = renderToStaticMarkup(<CallList rows={rows} showRm hasAnyCalls />);
    expect(html).toContain("Riya Shah");
    expect(html).toContain("Asha");
    expect(html).toContain("Complaint");
    expect(html).toContain('href="/calls/a1"');
    expect(html).toContain("Has recording");
    expect(html).not.toContain("9876543210");
    expect(html).not.toContain("secret-path");
  });
  it("hides the RM column for an RM's own view", () => {
    expect(renderToStaticMarkup(<CallList rows={[buildCallRow(record(), NOW)]} showRm={false} hasAnyCalls />)).not.toContain("Asha");
  });
  it("has distinct empty states", () => {
    expect(renderToStaticMarkup(<CallList rows={[]} showRm hasAnyCalls={false} />)).toContain("No calls to review yet");
    const filtered = renderToStaticMarkup(<CallList rows={[]} showRm hasAnyCalls />);
    expect(filtered).toContain("No calls match these filters");
    expect(filtered).toContain("Clear filters");
  });
  it("shows a live pulse for calls still waiting on a transcript", () => {
    const row = buildCallRow(record({ review: { id: "r", status: "PENDING_TRANSCRIPT", hasTranscript: false, qualityScore: null, overriddenScore: null, sentimentLabel: null, reviewedAt: null } }), NOW);
    expect(renderToStaticMarkup(<CallList rows={[row]} showRm hasAnyCalls />)).toContain("calls-live");
  });
});

describe("RollupPanel", () => {
  it("shows totals, RM averages and top flags", () => {
    const rows = [buildCallRow(record(), NOW), buildCallRow(record({ activityId: "a2", rmId: "rm2", rmName: "Dev", insights: [] }), NOW)];
    const html = renderToStaticMarkup(<RollupPanel rollup={buildRollup(rows)} />);
    expect(html).toContain("Average score by RM");
    expect(html).toContain("Asha");
    expect(html).toContain("Dev");
    expect(html).toContain("Complaint");
  });
  it("is calm when empty", () => {
    const html = renderToStaticMarkup(<RollupPanel rollup={buildRollup([])} />);
    expect(html).toContain("No calls in this view.");
    expect(html).toContain("No flags in this view.");
  });
});

describe("CallFiltersForm", () => {
  it("is a GET form with labelled controls and reflects active filters", () => {
    const html = renderToStaticMarkup(<CallFiltersForm filters={parseFilters({ flagged: "1", outcome: "missed" })} rms={[{ id: "rm1", name: "Asha" }]} showRm />);
    expect(html).toContain('method="get"');
    expect(html).toContain("Asha");
    expect(html).toContain('name="flagged"');
    expect(html).toContain("Clear");
  });
  it("carries the open section in a hidden field so applying a filter keeps it, and Clear returns to that section", () => {
    const html = renderToStaticMarkup(<CallFiltersForm filters={parseFilters({ flagged: "1" })} rms={[]} showRm={false} tab="rollup" />);
    expect(html).toContain('type="hidden" name="tab" value="rollup"');
    expect(html).toContain('href="/calls?tab=rollup"');
    expect(renderToStaticMarkup(<CallFiltersForm filters={parseFilters({})} rms={[]} showRm={false} />)).not.toContain('name="tab"');
  });
  it("omits the RM filter for RMs", () => {
    expect(renderToStaticMarkup(<CallFiltersForm filters={parseFilters({})} rms={[]} showRm={false} />)).not.toContain('name="rm"');
  });
});

describe("CallMedia", () => {
  const turns = parseTranscript("[00:03] RM: Hello there.\n[00:08] Customer: Hi.");
  it("renders an audio element that does not autoplay and points at the proxy, not the provider", () => {
    const html = renderToStaticMarkup(<CallMedia callId="a1" hasRecording turns={turns} analysisNote={null} />);
    expect(html).toContain("<audio");
    expect(html).toContain("controls");
    expect(html).toContain('preload="none"');
    expect(html).not.toContain("autoplay");
    expect(html).toContain('src="/api/calls/a1/recording"');
    expect(html).toContain("Play from 0:03");
  });
  it("renders speaker turns", () => {
    const html = renderToStaticMarkup(<CallMedia callId="a1" hasRecording={false} turns={turns} analysisNote={null} />);
    expect(html).toContain("Hello there.");
    expect(html).toContain("Customer");
    expect(html).not.toContain("<audio");
    expect(html).toContain("No recording is stored for this call.");
  });
  it("explains a missing transcript", () => {
    expect(renderToStaticMarkup(<CallMedia callId="a1" hasRecording={false} turns={[]} analysisNote="Waiting for the transcript from the telephony provider." />)).toContain("Waiting for the transcript");
  });
  it("renders only a window of a very long transcript", () => {
    const long = parseTranscript(Array.from({ length: 2000 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}] RM: Turn number ${i}`).join("\n"));
    const html = renderToStaticMarkup(<CallMedia callId="a1" hasRecording={false} turns={long} analysisNote={null} />);
    expect(html).toContain("Turn number 0<");
    expect(html).not.toContain("Turn number 1999<");
    expect((html.match(/<li /g) ?? []).length).toBeLessThan(60);
  });
});
