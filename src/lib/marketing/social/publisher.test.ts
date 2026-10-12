import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { STANDARD_RISK_LINE } from "./compliance";
import { createFakePublisher, getSocialPublisher } from "./publisher";

const GOOD = `Demat accounts explained.\n\n${STANDARD_RISK_LINE}\nSEBI Registration No: INZ000123456`;

describe("fake publisher", () => {
  it("is a simulation that records what it was asked and returns a clearly fake receipt", async () => {
    const p = createFakePublisher();
    expect(p.simulation).toBe(true);
    const receipt = await p.publish({ postId: "p1", channel: "linkedin", body: GOOD, scheduledFor: new Date("2026-10-15T04:00:00Z") });
    expect(receipt).toMatchObject({ accepted: true, providerRef: "fake-p1" });
    expect(p.published).toHaveLength(1);
  });

  it("checkReady refuses an unsupported channel, an empty body and a body over the channel limit", () => {
    const p = createFakePublisher();
    expect(p.checkReady({ postId: "p", channel: "linkedin", body: GOOD, scheduledFor: null })).toEqual({ ok: true });
    expect(p.checkReady({ postId: "p", channel: "x", body: GOOD, scheduledFor: null })).toMatchObject({ ok: false });
    expect(p.checkReady({ postId: "p", channel: "linkedin", body: " ", scheduledFor: null })).toMatchObject({ ok: false });
    expect(p.checkReady({ postId: "p", channel: "instagram", body: "a".repeat(2201), scheduledFor: null })).toMatchObject({ ok: false });
  });

  it("the app gets the fake: no real adapter is wired", () => {
    expect(getSocialPublisher().simulation).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("nothing publishes automatically", () => {
  it("no page, action or job calls a publisher's publish(): only the publisher module itself defines it", () => {
    const roots = [join(process.cwd(), "src/app"), join(process.cwd(), "src/lib")];
    const offenders = roots
      .flatMap(sourceFiles)
      .filter((f) => !f.endsWith(join("social", "publisher.ts")))
      .filter((f) => /\bpublisher\b[^\n]*\.publish\s*\(|getSocialPublisher\s*\(\s*\)\s*\.publish\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
