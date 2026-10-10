/**
 * One visibility rule for a conversation review, shared by the detail page (read) and the review action (write), so the two can
 * never disagree. `visibleUserIds` is null for unrestricted viewers (Admin); anyone else sees reviews assigned to someone in their
 * scope, and a conversation nobody owns yet is open to the Admins and Managers who can reach this at all.
 */
export function canAccessReview(visibleUserIds: string[] | null, review: { assignedRmId: string | null }): boolean {
  if (!visibleUserIds) return true;
  if (!review.assignedRmId) return true;
  return visibleUserIds.includes(review.assignedRmId);
}
