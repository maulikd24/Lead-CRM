import type { Role } from "@/generated/prisma/client";
import type { WorkspaceKey } from "@/lib/nav-items";

export function resolveWorkspace(role: Role): WorkspaceKey {
  switch (role) {
    case "PARTNER":
    case "AFFILIATE":
    case "DISTRIBUTOR":
      return "partner";
    case "TEAM_MANAGER":
      return "management";
    case "FINANCE":
      return "finance";
    default:
      return "core";
  }
}

/** Home route for a role — used by requireRole()'s unauthorized-redirect fallback. */
export function resolveWorkspaceHome(role: Role): string {
  switch (role) {
    case "DEALER":
      return "/dealer-desk";
    case "PARTNER":
    case "AFFILIATE":
    case "DISTRIBUTOR":
      return "/partner-home";
    case "TEAM_MANAGER":
      return "/management-console";
    case "FINANCE":
      return "/finance-console";
    default:
      return "/clients";
  }
}
