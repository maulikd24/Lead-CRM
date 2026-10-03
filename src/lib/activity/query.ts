import type { Prisma, UserEventType } from "@/generated/prisma/client";
import { istRangeFromDateKeys } from "@/lib/utils/ist-date";

export const EVENT_TYPE_OPTIONS: { value: UserEventType; label: string }[] = [
  { value: "LOGIN_SUCCESS", label: "Sign-in" },
  { value: "LOGIN_FAILED", label: "Failed sign-in" },
  { value: "LOGOUT", label: "Sign-out" },
  { value: "PAGE_VIEW", label: "Page view" },
  { value: "DATA_CREATE", label: "Created" },
  { value: "DATA_UPDATE", label: "Updated" },
  { value: "DATA_DELETE", label: "Deleted" },
  { value: "EXPORT", label: "Download" },
];

export type ActivityLogParams = {
  user?: string;
  type?: string;
  from?: string;
  to?: string;
  q?: string;
};

/**
 * One scoping rule for the page, the per-user card and the CSV export: Admin (visibleUserIds = null)
 * sees everything including failed sign-ins for unknown emails; anyone else only sees events from users
 * inside their visible team. A user filter is honoured only if it is inside that scope (never widens).
 */
export function buildUserEventWhere(params: ActivityLogParams, visibleUserIds: string[] | null): Prisma.UserEventWhereInput {
  const scoped: Prisma.UserEventWhereInput = {};
  if (visibleUserIds) scoped.userId = { in: visibleUserIds };
  if (params.user && (!visibleUserIds || visibleUserIds.includes(params.user))) scoped.userId = params.user;

  const range = istRangeFromDateKeys(params.from, params.to);
  const validType = EVENT_TYPE_OPTIONS.some((o) => o.value === params.type);

  return {
    ...scoped,
    ...(validType ? { type: params.type as UserEventType } : {}),
    ...(range.gte || range.lt ? { createdAt: { ...(range.gte ? { gte: range.gte } : {}), ...(range.lt ? { lt: range.lt } : {}) } } : {}),
    ...(params.q
      ? {
          OR: [
            { summary: { contains: params.q, mode: "insensitive" } },
            { path: { contains: params.q, mode: "insensitive" } },
            { entity: { contains: params.q, mode: "insensitive" } },
            { userEmail: { contains: params.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}
