# Content Writer, Campaign Manager and Marketing Manager: permission matrix (spec)

Status: spec only, for owner approval. Written 14 Oct 2026 from the demo feedback line "Content Writer, Campaign Manager and Marketing Manager".
**Nothing here is built. No role has been added and no permission has been changed or broadened.** Adding a role changes the `Role` enum (a migration), the access registry and every role list in `src/lib/access/policy.ts`, so it needs the owner's explicit go-ahead.

## 1. Today

There is one marketing role, `MARKETING`, plus `ADMIN`. They share the same areas (`src/lib/access/policy.ts`, group `marketing`). Everything MARKETING holds is aggregate or pseudonymous data; it has no customer rows and no RM work. Four-eyes approvals exist for social posts, campaign plans, ad creatives and director reports: the approver must be a different person from the requester, and the approver roles today are `ADMIN` and `MARKETING`.

The present gap is that a person who writes copy has the same rights as the person who approves spend.

## 2. The three roles (proposed intent)

| Role | Purpose |
|---|---|
| Content Writer | Writes copy and drafts. Cannot publish, cannot approve, cannot see spend. |
| Campaign Manager | Plans and runs campaigns, reads performance and spend, proposes creatives. Cannot approve their own plan. |
| Marketing Manager | Approves plans, creatives, social posts and reports, manages integrations settings, sees everything in Marketing. |

ADMIN keeps everything. No marketing role may ever see a customer row, a client page, RM work, partner money, or the Admin workspace.

## 3. Matrix

V = view, M = manage (create and edit), A = approve (decide a four-eyes request), E = export. A dash means no access. Rows are existing areas; the MARKETING column is exactly what holds today; the three proposed columns are proposals only.

| Area (existing) | MARKETING today | Content Writer | Campaign Manager | Marketing Manager |
|---|---|---|---|---|
| `marketing` (campaigns, reports, digests) | V M E | V | V M | V M E |
| `marketing-creative` | V M | V M (drafts only) | V M | V M |
| `marketing-social` (drafts and posts) | V M | V M (drafts only) | V M | V M |
| `marketing-competitor-ads` | V M | V | V M | V M |
| `marketing-experiments` | V M | - | V M | V M |
| `marketing-autopilot` | V M | - | V | V M |
| `marketing-attribution` | V E | - | V | V E |
| `marketing-planner` | V M | V (copy drafts only) | V M | V M |
| `marketing-planner-registry` | V | - | V | V |
| `marketing-reports` | V E | - | V | V E |
| `product-registry-claims` (approved claims) | V | V | V | V |
| `attention-marketing` (campaign anomalies) | V M | - | V M | V M |
| `action-ledger-campaigns` | V | - | V | V |
| `marketing-ad-integrations` | V M | - | V | V M |
| `referral-program` | V M | - | V | V M |
| `tasks` | V M | V M | V M | V M |

Approvals (four-eyes, existing kinds):

| Kind | MARKETING today | Content Writer | Campaign Manager | Marketing Manager |
|---|---|---|---|---|
| Social post | request, approve | request | request | approve |
| Campaign plan | request, approve | - | request | approve |
| Ad creative variant | request, approve | request | request | approve |
| Director report publication | request, approve | - | request | approve |
| Autopilot ad action | approve | - | - | approve |

The rule that the approver is never the requester stays, and is the reason the split is wanted.

## 4. Rules that must hold whatever is decided

1. Default deny: a role with no entry for an area has no access, and the access coverage test must list every new role.
2. No marketing role is added to a customer, client, RM, partner-money or Admin area.
3. Content Writer never sees spend, budgets or attribution.
4. Nothing customer-facing is sent automatically by any role; every send keeps its approval.
5. Marketing Manager is the only non-Admin approver, and still cannot approve what they requested.
6. Existing MARKETING users: either keep `MARKETING` as it is (recommended for the first release, so nobody loses access) or map each person to one of the three. Decide before any migration.

## 5. What building it would involve (for sizing only)

A migration adding three enum values (additive), a `Role` list update in `policy.ts` and `src/lib/nav-items.ts` (`roles`), the approver lists in `src/lib/policy/approvals/canonical/definitions.ts`, the nav gating contract test, the access matrix page, the handbook roles section, and seeded synthetic users for tests. The Roles and access page (`/settings/access`) already generates the matrix from the registry, so the new roles appear there for free once registered.

## 6. Open questions for the owner

- Q1. Replace `MARKETING` or keep it alongside the three?
- Q2. May a Campaign Manager see spend and cost per lead, or only lead and conversion counts?
- Q3. Does the Marketing Manager approve ad budgets, or only content and plans?
- Q4. Are copy drafts reviewed by compliance before the Marketing Manager sees them (the ad-approval annexure flow)? If yes, which role is the compliance reviewer?
- Q5. Should a Content Writer see approved claims only, as shown, or also the product registry?
