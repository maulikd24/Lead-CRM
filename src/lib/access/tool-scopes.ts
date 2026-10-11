import { can, type Area } from "./policy";

/**
 * The areas behind the tools the "Ask the system" model may call. Every tool reads customer data, so every tool needs
 * the customer-intelligence area; a role without it gets no tools (and the action refuses it before the model is called).
 * A tool that is not listed here is never offered and never run, even if the model asks for it by name.
 */
export const ASK_TOOL_AREA: Record<string, Area> = {
  find_customers: "intelligence",
  funnel: "intelligence",
  lifecycle_breakdown: "intelligence",
  team_followups: "intelligence",
  top_objections: "intelligence",
  stage_conversion: "intelligence",
};

export function askToolAllowed(role: string | null | undefined, tool: string): boolean {
  const area = ASK_TOOL_AREA[tool];
  return !!area && can(role, area, "manage");
}

export function askToolsFor(role: string | null | undefined): string[] {
  return Object.keys(ASK_TOOL_AREA).filter((t) => askToolAllowed(role, t));
}
