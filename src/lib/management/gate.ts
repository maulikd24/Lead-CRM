import { can } from "@/lib/access/policy";

import { headlineKpis, type HeadlineKpis, type KpiInput, type KpiProblem } from "./kpis";

/**
 * The one way to read the management KPIs. Two gates, both must pass: the server flag MANAGEMENT_INTEL_ENABLED (default off,
 * a flag is on only for the exact value "1") and the access registry (area "management-intelligence": Admin and Manager).
 * Read only: nothing here writes anything.
 */

export const MANAGEMENT_INTEL_FLAG = "MANAGEMENT_INTEL_ENABLED";
export const MANAGEMENT_INTEL_AREA = "management-intelligence";

export function managementIntelEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[MANAGEMENT_INTEL_FLAG] === "1";
}

export type ManagementView =
  | { ok: true; kpis: HeadlineKpis }
  | { ok: false; reason: "disabled" | "forbidden" }
  | { ok: false; reason: "invalid_input"; problems: KpiProblem[] };

export function viewManagementKpis(args: { role: string | null | undefined; env?: Record<string, string | undefined>; input: KpiInput }): ManagementView {
  if (!managementIntelEnabled(args.env ?? process.env)) return { ok: false, reason: "disabled" };
  if (!can(args.role, MANAGEMENT_INTEL_AREA, "view")) return { ok: false, reason: "forbidden" };
  const r = headlineKpis(args.input);
  if (!r.ok) return { ok: false, reason: "invalid_input", problems: r.problems };
  return { ok: true, kpis: r.kpis };
}
