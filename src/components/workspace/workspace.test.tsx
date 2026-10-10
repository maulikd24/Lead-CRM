import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COUNT_UP_MS, CountUp, DrawIn, RailCard, RailFact, Skeleton, StickyRail, WorkspacePanel, WorkspaceShell, WorkspaceTabs } from "./index";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "tickets", label: "Tickets", count: 3 },
];
const html = (el: React.ReactElement) => renderToString(el);

describe("WorkspaceTabs roles and wiring", () => {
  const out = html(<WorkspaceTabs tabs={TABS} active="timeline" idPrefix="ws" label="Sections" hrefFor={(k) => `/x?tab=${k}`} />);
  it("is a tablist with one tab per section, named", () => {
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Sections"');
    expect((out.match(/role="tab"/g) ?? []).length).toBe(3);
  });
  it("marks exactly the active tab selected and makes it the only tab stop (roving tabindex)", () => {
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="0"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(2);
    expect(out).toMatch(/id="ws-tab-timeline"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="ws-tab-timeline"/);
  });
  it("points each tab at its panel and gives every tab a real href (deep link, no-JS)", () => {
    expect(out).toContain('aria-controls="ws-panel-timeline"');
    expect(out).toContain('href="/x?tab=tickets"');
  });
  it("shows a count only when there is one", () => {
    expect(out).toContain(">3<");
    expect(html(<WorkspaceTabs tabs={[{ key: "a", label: "A", count: 0 }]} active="a" idPrefix="p" label="L" hrefFor={() => "/"} />)).not.toContain(">0<");
  });
  it("client-driven tabs render plain anchors too", () => {
    const client = html(<WorkspaceTabs tabs={TABS} active="overview" idPrefix="ws" label="Sections" hrefFor={(k) => `/c?tab=${k}`} onSelect={() => {}} />);
    expect(client).toContain('href="/c?tab=timeline"');
    expect(client).toContain('role="tab"');
  });
});

describe("WorkspaceShell and WorkspacePanel", () => {
  const out = html(
    <WorkspaceShell header={<h1>Riya</h1>} tabs={<WorkspaceTabs tabs={TABS} active="timeline" idPrefix="ws" label="Sections" hrefFor={() => "/"} />} toolbar={<span>range</span>} rail={<StickyRail facts={<RailFact label="AUM">1</RailFact>} actions={<button>Go</button>} />}>
      <WorkspacePanel tab="timeline" idPrefix="ws">
        <p>body</p>
      </WorkspacePanel>
    </WorkspaceShell>,
  );
  it("renders the header, the tab bar with its toolbar, the rail and the one panel", () => {
    expect(out).toContain("<header");
    expect(out).toContain("Riya");
    expect(out).toContain("range");
    expect(out).toContain("<aside");
    expect(out).toContain("Key facts and actions");
    expect((out.match(/role="tabpanel"/g) ?? []).length).toBe(1);
  });
  it("labels the panel by the active tab and makes it focusable", () => {
    expect(out).toContain('id="ws-panel-timeline"');
    expect(out).toContain('aria-labelledby="ws-tab-timeline"');
    expect(out).toMatch(/role="tabpanel"[^>]*tabindex="0"|tabindex="0"[^>]*role="tabpanel"/);
  });
  it("reserves the rail column only when there is a rail", () => {
    expect(out).toContain('data-rail="true"');
    const bare = html(<WorkspaceShell tabs={<span />} fill={false}><WorkspacePanel tab="a" idPrefix="p">x</WorkspacePanel></WorkspaceShell>);
    expect(bare).toContain('data-rail="false"');
    expect(bare).toContain('data-fill="false"');
    expect(html(<WorkspaceShell tabs={<span />} hasRail><span /></WorkspaceShell>)).toContain('data-rail="true"');
  });
  it("marks a loading panel busy", () => {
    expect(html(<WorkspacePanel tab="a" idPrefix="p" busy>x</WorkspacePanel>)).toContain('aria-busy="true"');
    expect(html(<WorkspacePanel tab="a" idPrefix="p">x</WorkspacePanel>)).not.toContain("aria-busy");
  });
});

describe("rail blocks", () => {
  it("RailFact shows label, value and hint; a live fact gets the dot", () => {
    const out = html(<RailFact label="Open tickets" hint="2 urgent" live>3</RailFact>);
    expect(out).toContain("Open tickets");
    expect(out).toContain("2 urgent");
    expect(out).toContain("rounded-full");
  });
  it("RailCard is a labelled region", () => {
    const out = html(<RailCard title="Next step" labelId="nx">Call</RailCard>);
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-labelledby="nx"');
    expect(out).toContain('id="nx"');
  });
});

describe("motion helpers render real content on the server (reduced motion and no-JS see the final value)", () => {
  it("CountUp renders the final number, plus a screen-reader label", () => {
    const out = html(<CountUp value={1234567} label="AUM" />);
    expect(out).toContain("12,34,567");
    expect(out).toContain("AUM: 12,34,567");
  });
  it("CountUp uses the caller's format and shows an empty state for null", () => {
    expect(html(<CountUp value={0.256} format={(n) => `${(n * 100).toFixed(1)}%`} />)).toContain("25.6%");
    expect(html(<CountUp value={null} />)).toContain("—");
    expect(html(<CountUp value={null} empty="n/a" />)).toContain("n/a");
  });
  it("keeps the count-up to the 300ms ceiling", () => expect(COUNT_UP_MS).toBeLessThanOrEqual(300));
  it("Skeleton is hidden from assistive tech and never uses the looping pulse", () => {
    const out = html(<Skeleton className="h-4" />);
    expect(out).toContain('aria-hidden="true"');
    expect(out).not.toContain("animate-pulse");
  });
  it("DrawIn keeps its children visible", () => {
    expect(html(createElement(DrawIn, null, createElement("p", null, "chart")))).toContain("chart");
  });
});
