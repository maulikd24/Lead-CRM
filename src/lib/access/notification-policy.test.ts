import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "./policy";
import { NOTIFICATION_AREA, notificationAllowed, notificationVisibleWhere } from "./notification-policy";

const describedTypes = [...new Set([...readFileSync(join(process.cwd(), "src/lib/notifications/describe.ts"), "utf8").matchAll(/case "([a-z_0-9]+)"/g)].map((m) => m[1]))];

describe("every notification type has a declared area (default deny)", () => {
  it("finds the types (sanity)", () => expect(describedTypes.length).toBeGreaterThan(30));
  it("maps every type the bell can describe", () => expect(describedTypes.filter((t) => !(t in NOTIFICATION_AREA))).toEqual([]));
  it("does not map a type that no longer exists", () => expect(Object.keys(NOTIFICATION_AREA).filter((t) => !describedTypes.includes(t))).toEqual([]));
  it("refuses an unknown type to everyone but ADMIN", () => {
    for (const role of ALL_ROLES) expect(notificationAllowed(role, "brand_new_type"), role).toBe(role === "ADMIN");
  });
});

describe("who sees which notification", () => {
  it("shows ADMIN everything and puts no restriction on the query", () => {
    for (const t of describedTypes) expect(notificationAllowed("ADMIN", t)).toBe(true);
    expect(notificationVisibleWhere("ADMIN")).toEqual({});
  });
  it("shows MARKETING no customer, task-of-a-customer, call, support or system notification", () => {
    const seen = describedTypes.filter((t) => notificationAllowed("MARKETING", t));
    expect(seen).toEqual([]);
    expect(notificationVisibleWhere("MARKETING")).toEqual({ type: { in: [] } });
  });
  it("shows an RM their customer and task notifications but not audit or WhatsApp health alerts", () => {
    for (const t of ["stage_sla_breach", "kyc_update", "task_overdue", "new_assignment", "inbound_message"]) expect(notificationAllowed("RM", t), t).toBe(true);
    for (const t of ["audit_chain_broken", "whatsapp_offline", "bug_report_filed", "weekly_report_send_failed"]) expect(notificationAllowed("RM", t), t).toBe(false);
  });
  it("shows a dealer only the dealer introduction", () => {
    expect(describedTypes.filter((t) => notificationAllowed("DEALER", t))).toEqual(["dealer_intro_pending"]);
  });
  it("builds a query that lists exactly the allowed types", () => {
    const where = notificationVisibleWhere("RM") as { type: { in: string[] } };
    expect(where.type.in.sort()).toEqual(describedTypes.filter((t) => notificationAllowed("RM", t)).sort());
  });
});
