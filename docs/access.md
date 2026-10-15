# Access: one registry, default deny

Who may see or do what is decided in ONE file, `src/lib/access/policy.ts`: a typed table of area x action (view, manage, export) x role. Anything not written there is refused for every role. ADMIN holds every action on every declared area, so it is never listed.

| Piece | Where |
|---|---|
| The table, `can(role, area, action)`, `rolesWith()` | `src/lib/access/policy.ts` |
| Marketing gate: `canAccessMarketing(role)` (ADMIN and MARKETING only), `requireMarketing(area, action)` | `src/lib/access/marketing-access.ts`, `src/lib/auth/require-role.ts` |
| Page and action guard `requireAccess(area, action)`; API guard `apiGuard(area, action)` | `src/lib/auth/require-role.ts`, `src/lib/access/api-guard.ts` |
| Inventory of every page, server-action file, API route, scheduled job and other surface | `src/lib/access/surfaces.ts` |
| Notifications, Ask tools, own-tasks scope, lead campaign label, pseudonyms | `notification-policy.ts`, `tool-scopes.ts`, `own-tasks.ts`, `lead-context.ts`, `pseudonym.ts` |
| Roles and access, View as role | `/settings/access` (Admin), `src/lib/access/matrix.ts` |

`src/lib/access/surface-coverage.test.ts` walks `src/app` and fails when a page, server action file or API route has no entry in `surfaces.ts`, when the source does not call the guard its entry names, or when a role list in the source lets in a role the registry refuses. It also checks every cron job and every notification type.

Adding a screen: add its area to `policy.ts` (or reuse one), add its route to `PAGE_POLICY`, call `requireAccess("area")` first thing. Marketing screens call `requireMarketing()`. Nothing else is needed; the sidebar, Cmd+K, the matrix page and the tests follow.
