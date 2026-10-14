import { canViewClient } from "@/lib/clients/access";
import { maskContactFields } from "@/lib/privacy/contact-mask";

type Match = { id: string; name: string; clientCode: string; mobile: string | null; email: string | null; pan?: string | null; assignedToId: string | null };
export type BrowserDuplicate = { id: string; name: string; clientCode: string; mobile: string | null; email: string | null };

/**
 * A duplicate match made safe for the browser: contacts masked, PAN never returned, and a customer outside the caller's scope
 * reduced to "one exists" plus its code (id blank, so nothing links to it).
 */
export function toBrowserDuplicate<R extends { duplicate: Match | null }>(
  result: R,
  scope: { role: string; visibleUserIds: string[] | null },
): Omit<R, "duplicate"> & { duplicate: BrowserDuplicate | null } {
  const { duplicate, ...rest } = result;
  if (!duplicate) return { ...rest, duplicate: null };
  if (!canViewClient(scope.role, scope.visibleUserIds, duplicate)) {
    return { ...rest, duplicate: { id: "", name: "An existing customer", clientCode: duplicate.clientCode, mobile: null, email: null } };
  }
  const { id, name, clientCode, mobile, email } = maskContactFields(duplicate);
  return { ...rest, duplicate: { id, name, clientCode, mobile, email } };
}
