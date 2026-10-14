import { describe, expect, it } from "vitest";

import type { AttentionItem } from "@/lib/attention/engine";
import { dedupeAnomalies } from "@/app/(dashboard)/marketing/needs-attention/anomaly-table";

const item = (id: string, campaign: string, subKind: string) => ({ id, subKind, subject: { type: "campaign", id: campaign, label: campaign } }) as unknown as AttentionItem;

describe("dedupeAnomalies", () => {
  it("keeps one row per campaign and kind, and keeps two kinds on the same campaign", () => {
    const out = dedupeAnomalies([item("1", "a", "spend_spike"), item("2", "a", "spend_spike"), item("3", "a", "spend_no_leads"), item("4", "b", "spend_spike")]);
    expect(out.map((i) => i.id)).toEqual(["1", "3", "4"]);
  });
});
