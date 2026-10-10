import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MasterDetail, PhoneRow, StickyBar, type DenseItem } from "./dense";

const items = (n: number): DenseItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, title: `Item ${i}`, meta: `meta ${i}`, amount: `₹${i}`, badges: [{ label: "Needs review", variant: "warning" as const }] }));
const details = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`i${i}`, <p key={i}>{`Detail of ${i}`}</p>]));
const html = (el: React.ReactElement) => renderToString(el);

describe("MasterDetail", () => {
  const out = html(<MasterDetail idPrefix="t" label="Things" noun="things" items={items(8)} details={details(8)} />);
  it("is a named listbox of options with exactly one selected and one tab stop", () => {
    expect(out).toContain('role="listbox"');
    expect(out).toContain('aria-label="Things"');
    expect((out.match(/role="option"/g) ?? []).length).toBe(8);
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((out.match(/tabindex="0"[^>]*data-item-id|data-item-id[^>]*tabindex="0"/g) ?? []).length).toBe(1);
  });
  it("selects the first item by default, or the requested one when it exists", () => {
    expect(out).toContain("Detail of 0");
    expect(out).not.toContain("Detail of 1<");
    expect(html(<MasterDetail idPrefix="t" label="Things" noun="things" items={items(8)} details={details(8)} initial="i3" />)).toContain("Detail of 3");
    expect(html(<MasterDetail idPrefix="t" label="Things" noun="things" items={items(8)} details={details(8)} initial="nope" />)).toContain("Detail of 0");
  });
  it("on a phone shows the top 5 and tucks the rest behind View all (n); a short list has no such button", () => {
    expect((out.match(/max-lg:hidden/g) ?? []).length).toBe(3);
    expect(out).toContain("View all (8) things");
    const short = html(<MasterDetail idPrefix="t" label="Things" noun="things" items={items(4)} details={details(4)} />);
    expect(short).not.toContain("View all");
    expect(short).not.toContain("max-lg:hidden");
  });
  it("shows the detail only from a laptop up (the phone gets a sheet)", () => {
    expect(out).toMatch(/class="hidden[^"]*lg:block"/);
  });
  it("shows the amount and badges of each item", () => {
    expect(out).toContain("₹3");
    expect(out).toContain("Needs review");
  });
  it("renders the empty state, and notes above and below the panes", () => {
    expect(html(<MasterDetail idPrefix="t" label="Things" noun="things" items={[]} details={{}} empty={<p>Nothing here</p>} />)).toContain("Nothing here");
    const withNotes = html(<MasterDetail idPrefix="t" label="Things" noun="things" items={items(2)} details={details(2)} before={<p>Above</p>} after={<p>Below</p>} />);
    expect(withNotes.indexOf("Above")).toBeLessThan(withNotes.indexOf("role=\"listbox\""));
    expect(withNotes.indexOf("Below")).toBeGreaterThan(withNotes.indexOf("role=\"listbox\""));
  });
});

describe("PhoneRow and StickyBar", () => {
  it("PhoneRow is one dense row on a phone and the content in place from a laptop", () => {
    const out = html(<PhoneRow title="Weekly" summary="30 in 8 weeks"><p>The chart</p></PhoneRow>);
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain("30 in 8 weeks");
    expect(out).toContain("The chart");
  });
  it("StickyBar is a labelled group that the page leaves room for", () => {
    const out = html(<StickyBar label="Referral actions"><button>Go</button></StickyBar>);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-label="Referral actions"');
  });
});

describe("the dense layout's motion and tokens", () => {
  const css = readFileSync(path.join(__dirname, "dense.module.css"), "utf8");
  it("has no animation longer than 300 ms, nothing infinite, and switches animation off for reduced motion", () => {
    for (const m of css.matchAll(/animation:[^;]*?(\d+)ms/g)) expect(Number(m[1])).toBeLessThanOrEqual(300);
    expect(css).not.toMatch(/infinite/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
  it("uses theme tokens, not literal colours", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });
});
