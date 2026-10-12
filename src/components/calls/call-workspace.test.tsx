import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const nav = vi.hoisted(() => ({ tab: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.tab ? `tab=${nav.tab}` : ""),
  usePathname: () => "/calls/a1",
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/app/(dashboard)/calls/actions", () => ({ createFollowUpTaskAction: vi.fn(), markCallReviewedAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CallWorkspace } from "./call-workspace";
import { CallFilterToolbar } from "./call-filter-toolbar";
import { buildCallDetail } from "@/lib/calls/detail";
import { parseFilters } from "@/lib/calls/view-model";

const NOW = new Date("2026-10-09T10:00:00Z");
const call = (over: Record<string, unknown> = {}) =>
  buildCallDetail(
    {
      activityId: "a1", occurredAt: new Date("2026-10-08T10:00:00Z"), payload: { direction: "outbound", durationSeconds: 120, recordingUrl: "https://example.test/r" }, customerName: "Riya Shah", clientId: "c1", rmId: "r1", rmName: "RM Raj",
      review: {
        id: "rv1", status: "ANALYZED", transcript: "[0:02] RM: Good morning.\n[0:09] Customer: Hello there.", sentimentLabel: "positive", sentimentReasoning: "Calm.", qualityScore: 82, overriddenScore: null,
        qualityBreakdown: [{ criterion: "greeting_introduction", score: 9, maxScore: 10, notes: "Clear opening." }], recommendationText: "Send the steps.", failureReason: null, reviewedAt: null, reviewedByName: null, reviewNotes: null, task: null,
      },
      insights: [{ id: "i1", kind: "COMMITMENT", text: "Send steps today.", status: "OPEN", dueAt: new Date("2026-10-12T00:00:00Z"), severity: null }],
      ...over,
    } as Parameters<typeof buildCallDetail>[0],
    NOW,
  );
const html = (tab = "", c = call(), isManager = true) => {
  nav.tab = tab;
  return renderToStaticMarkup(<CallWorkspace call={c} isManager={isManager} />);
};

describe("CallWorkspace", () => {
  it("has the four tabs and one panel, transcript first", () => {
    const out = html();
    expect(out).toContain('role="tablist"');
    for (const label of ["Transcript", "Scores", "Actions", "Recording"]) expect(out).toContain(label);
    expect(out.match(/role="tabpanel"/g)).toHaveLength(1);
    expect(out).toMatch(/id="call-tab-transcript"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="call-tab-transcript"/);
    expect(out).toContain("Good morning.");
  });
  it("keeps one audio player, in the header, whichever tab is open", () => {
    for (const tab of ["", "scores", "actions", "recording"]) expect(html(tab).match(/<audio/g)).toHaveLength(1);
  });
  it("has no player when there is no recording", () => {
    const out = html("recording", call({ payload: { direction: "outbound", durationSeconds: 120 } }));
    expect(out).not.toContain("<audio");
    expect(out).toContain("No recording is stored for this call.");
  });
  it("scores tab shows the rubric, not the transcript", () => {
    const out = html("scores");
    expect(out).toContain("How it scored");
    expect(out).toContain("Greeting");
    expect(out).not.toContain("Good morning.");
  });
  it("actions tab shows what came up and the review form for a manager", () => {
    const out = html("actions");
    expect(out).toContain("What came up");
    expect(out).toContain("Send steps today.");
    expect(out).toContain("Create follow-up task");
    expect(out).toContain("Mark reviewed");
  });
  it("actions tab hides the reviewer form from a non-manager", () => {
    expect(html("actions", call(), false)).not.toContain("Mark reviewed");
  });
  it("recording tab lists timestamped lines to jump to", () => {
    const out = html("recording");
    expect(out).toContain("Jump to");
    expect(out).toContain("0:09");
  });
  it("puts call facts and review status in the rail", () => {
    const out = html();
    for (const label of ["Quality score", "Outcome", "Review", "Flags", "Review status"]) expect(out).toContain(label);
    expect(out).toContain("A manager has not reviewed this call yet.");
  });
  it("an unknown ?tab= falls back to the transcript", () => {
    expect(html("nope")).toContain("Good morning.");
  });
});

describe("CallFilterToolbar", () => {
  it("renders one Filters button, collapsed, with the number of active filters", () => {
    const out = renderToStaticMarkup(<CallFilterToolbar filters={parseFilters({ flagged: "1", band: "low" })} rms={[]} showRm={false} />);
    expect(out).toContain("Filters (2)");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("<form");
  });
});
