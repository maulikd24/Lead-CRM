/**
 * The client detail page's visibility rule, in one place so the page and its Customer 360 view can never disagree.
 * `visibleUserIds` is null for unrestricted viewers (see getVisibleUserIds). Unassigned leads are open to Admins and
 * to Managers, who are the ones who assign them.
 */
export function canViewClient(role: string, visibleUserIds: string[] | null, client: { assignedToId: string | null }): boolean {
  const managerMayOpenUnassigned = !client.assignedToId && role === "MANAGER";
  if (visibleUserIds && !managerMayOpenUnassigned && (!client.assignedToId || !visibleUserIds.includes(client.assignedToId))) return false;
  return true;
}

/**
 * Who may open a Customer 360 page: the detail page's rule, plus: a merged customer is not found for anyone (its
 * record lives on under the survivor), and an archived customer is visible to Admins only.
 */
export function canOpen360(role: string, visibleUserIds: string[] | null, client: { assignedToId: string | null; isDeleted: boolean; mergedIntoId: string | null }): boolean {
  if (client.mergedIntoId) return false;
  if (client.isDeleted && role !== "ADMIN") return false;
  return canViewClient(role, visibleUserIds, client);
}
