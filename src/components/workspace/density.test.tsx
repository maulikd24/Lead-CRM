import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("sheet=tasks&item=b"),
  usePathname: () => "/x",
  useRouter: () => ({ push: () => {} }),
}));

import { Fact, FactsStrip, MasterDetail, PhoneSheet, ShowFirst, ShowFirstBlock, StickyActionBar } from "./index";

const html = (el: React.ReactElement) => renderToString(el);
const rows = (n: number) => Array.from({ length: n }, (_, i) => <span key={i}>row {i + 1}</span>);

describe("ShowFirst", () => {
  it("shows every row in the page, marks the rows past the limit so a phone hides them, and offers View all (n)", () => {
    const out = html(<ShowFirst name="other" title="All rows" items={rows(8)} />);
    expect(out).toContain("<!-- -->8<");
    expect((out.match(/overflowItem/g) ?? []).length).toBe(3);
    expect(out).toContain("View all (8)");
    expect(out).toContain('aria-haspopup="dialog"');
  });
  it("has no button and no hidden rows when the list fits", () => {
    const out = html(<ShowFirst name="other" title="All rows" items={rows(4)} />);
    expect(out).not.toContain("View all");
    expect(out).not.toContain("overflowItem");
  });
  it("opens its sheet from ?sheet= (deep link) as a real dialog labelled by its title", () => {
    const out = html(<ShowFirst name="tasks" title="All tasks" items={rows(8)} />);
    expect(out).toContain("<dialog");
    expect(out).toContain('id="sheet-tasks"');
    expect(out).toContain("All tasks");
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toContain('aria-label="Close All tasks"');
  });
  it("mounts no sheet content while the sheet is closed", () => {
    const out = html(<ShowFirst name="other" title="Closed one" items={rows(8)} />);
    expect(out).not.toContain("Close Closed one");
  });
});

describe("ShowFirstBlock and PhoneSheet render once per screen size", () => {
  it("ShowFirstBlock: preview for phones, full for laptops, button only when there is more", () => {
    const out = html(<ShowFirstBlock name="b" title="All" total={9} preview={<i>PREVIEW</i>} full={<i>FULL</i>} />);
    expect(out).toContain("PREVIEW");
    expect(out).toContain("FULL");
    expect(out).toContain("View all (9)");
    expect(html(<ShowFirstBlock name="b" title="All" total={3} preview={<i>PREVIEW</i>} full={<i>FULL</i>} />)).not.toContain("View all");
  });
  it("PhoneSheet: a dense row for phones and the content in place for laptops", () => {
    const out = html(
      <PhoneSheet name="p" title="Client details" summary="Mumbai">
        <p>THE BODY</p>
      </PhoneSheet>,
    );
    expect(out).toContain("Client details");
    expect(out).toContain("Mumbai");
    expect(out).toContain("THE BODY");
    expect(out).toContain('aria-haspopup="dialog"');
  });
});

describe("FactsStrip and StickyActionBar", () => {
  it("the strip is a named, keyboard-scrollable list of facts", () => {
    const out = html(
      <FactsStrip label="At a glance">
        <Fact label="AUM">₹1</Fact>
        <Fact label="Tier" hint="since 2024" href="/x">A</Fact>
      </FactsStrip>,
    );
    expect(out).toContain('aria-label="At a glance"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain("AUM");
    expect(out).toContain('href="/x"');
  });
  it("the action bar is one labelled group", () => {
    const out = html(
      <StickyActionBar>
        <button>Message</button>
      </StickyActionBar>,
    );
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Primary actions"');
    expect(out).toContain('data-action-bar="true"');
  });
});

describe("MasterDetail", () => {
  const items = [
    { id: "a", title: "Alpha", meta: "first" },
    { id: "b", title: "Beta" },
    { id: "c", title: "Gamma" },
  ];
  const details = { a: <p>DETAIL A</p>, b: <p>DETAIL B</p>, c: <p>DETAIL C</p> };
  const out = html(<MasterDetail idPrefix="md" label="Goals" items={items} details={details} />);
  it("is a listbox of options, the selected one (from ?item=) is the only tab stop", () => {
    expect(out).toContain('role="listbox"');
    expect((out.match(/role="option"/g) ?? []).length).toBe(3);
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(out).toMatch(/data-item-id="b"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-item-id="b"/);
    expect((out.match(/tabindex="-1"/g) ?? []).length).toBe(2);
  });
  it("renders only the selected item's detail, in its own labelled, focusable panel", () => {
    expect(out).toContain("DETAIL B");
    expect(out).not.toContain("DETAIL A");
    expect(out).toContain('aria-label="Goals: details"');
  });
});

describe("density styles obey the motion budget", () => {
  const css = readFileSync(path.join(__dirname, "density.module.css"), "utf8");
  it("every duration is 300ms or less and nothing loops", () => {
    for (const m of css.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
      const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
      expect(ms, m[0]).toBeLessThanOrEqual(300);
    }
    expect(css).not.toMatch(/infinite/);
  });
  it("switches the animations off for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
  it("uses theme tokens, not literal colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgb\(|\bhsl\(/);
  });
});
