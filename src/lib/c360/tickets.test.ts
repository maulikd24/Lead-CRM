import { describe, expect, it } from "vitest";

import { buildTicketsView } from "./tickets";

const t = (id: string, status: string | null, createdAt: string | null, o: Partial<{ subject: string | null; priority: string | null }> = {}) => ({ id, externalId: id, subject: `Subject ${id}`, status, priority: null, channel: null, ticketCreatedAt: createdAt ? new Date(createdAt) : null, ticketUpdatedAt: null, ...o });

describe("buildTicketsView", () => {
  it("is empty for a customer with no tickets", () => {
    expect(buildTicketsView([])).toEqual({ total: 0, openCount: 0, shown: [], hiddenCount: 0 });
  });
  it("lists open tickets first, newest first within each group", () => {
    const v = buildTicketsView([t("a", "resolved", "2026-10-09T00:00:00Z"), t("b", "open", "2026-10-01T00:00:00Z"), t("c", "pending", "2026-10-05T00:00:00Z")]);
    expect(v.shown.map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(v.openCount).toBe(2);
    expect(v.shown[2].open).toBe(false);
  });
  it("treats a missing status as open (we cannot say it is closed) and a missing date as oldest", () => {
    const v = buildTicketsView([t("a", "closed", "2026-10-09T00:00:00Z"), t("b", null, null), t("c", "open", "2026-10-01T00:00:00Z")]);
    expect(v.shown.map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
  it("caps the list and says how many are not shown", () => {
    const rows = Array.from({ length: 8 }, (_, i) => t(String(i), "open", `2026-10-0${i + 1}T00:00:00Z`));
    const v = buildTicketsView(rows, 5);
    expect(v.shown).toHaveLength(5);
    expect(v.hiddenCount).toBe(3);
    expect(v.total).toBe(8);
  });
  it("gives a fallback subject and a readable status", () => {
    const v = buildTicketsView([t("a", "waiting_on_customer", "2026-10-01T00:00:00Z", { subject: null })]);
    expect(v.shown[0]).toMatchObject({ subject: "(no subject)", statusLabel: "Waiting on customer" });
  });
});
