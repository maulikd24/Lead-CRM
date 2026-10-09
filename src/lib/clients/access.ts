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
