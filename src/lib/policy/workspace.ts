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
    // TEAM_MANAGER/FINANCE fall back to /clients until their consoles ship — /clients is
    // requireUser()-gated only (no role allow-list), so it always renders safely.
    case "TEAM_MANAGER":
    case "FINANCE":
      return "/clients";
    default:
      return "/clients";
  }
}
