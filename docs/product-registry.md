# Product and Eligibility Registry

Wave 2, workstream C. Flag: `NEXT_PUBLIC_PRODUCT_REGISTRY` (default off, build-time). Code: `src/lib/registry/`. Admin screen: Settings, Product registry (`/settings/product-registry`).

## What it is for

One governed list of the products Allvest may talk about, and what is true of each. Agents, the campaign planner and the copy tools may only **cite a registry id**. They never state a product fact from model memory, and they cannot cite anything that is not approved.

## What a product holds

A product has a stable identity (`RegistryProduct`: key, status, the version in force) and any number of versions (`RegistryProductVersion`). A version holds: name, category, availability (open, limited, closed, by request), minimum investment (minor units and currency), investor eligibility rules, risk category, jurisdictions, required documents, sales restrictions, approved marketing claims (each with an id and an optional valid-until date), and valid-from and valid-to.

Status of the product: `DRAFT`, `APPROVED`, `SUSPENDED`, `RETIRED`. State of a version: `DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `SUPERSEDED`.

## The change flow (draft, review, approved)

1. An Admin creates a product or revises an existing one. That makes a **draft** version. An approved version is never edited in place.
2. The author submits it for review.
3. A **second Admin** approves or rejects it (maker-checker: the server refuses the author). Approval makes that version the one in force, supersedes the previous one and sets the product to `APPROVED`.
4. **Suspend** is immediate and needs a reason: the product can no longer be cited at once. Approving a new version of a suspended product is the review that reinstates it.
5. **Retire** is immediate, needs a reason and is final.

The safe direction is instant, the risky direction (making something citable) always needs a second person. Every step is one transaction with an `AuditLog` row (`registry.*`).

### Approval seam (until the Wave 1 approval service is merged)

`src/lib/registry/lifecycle.ts` is the small additive adapter: pure functions `submitForReview`, `decideReview`, `suspend`, `retire`, called by `service.ts`. At integration with the canonical approval service (`allvest/w1-approvals`), register an action type `PRODUCT_REGISTRY_CHANGE`, create an `ApprovalRequest` in `submitVersion`, and call the approval branch of `decideVersion` from its executor. The tests on `lifecycle.ts` stay valid. No existing approval code was touched.

## The citation guard

```ts
import { cite } from "@/lib/registry/service";
const c = await cite(productId);            // CitationResult
if (!c.ok) { /* c.reason: unknown_product | unapproved | suspended | retired | no_approved_version | not_yet_valid | expired | example_product */ }
else { c.name; c.facts; c.claims; c.versionId; c.asOf; }
```

`cite()` REFUSES anything that is not an approved, in-date product, and returns no product facts with a refusal. Status is judged first, so a retired or suspended product is refused even if its version still says approved. Only claims that are approved and not lapsed come back. `assertCitable(result)` throws `CitationRefusedError` for callers that prefer to throw. Every agent, planner and copy tool must go through this (or `listCitable()` / `listApprovedClaims()`); none may read the tables itself. `src/lib/registry/boundary.test.ts` fails when any file outside `lib/registry` and the Admin registry screens mentions the registry tables.

The pure core is `citeFromRecords` (`cite.ts`, 9 tests). Break checks run on it: removing the status checks, letting a suspended product through, letting an unapproved version through, letting an example through in production, and removing the maker-checker rule each fail a test.

## Example products

`seed-examples.ts` creates six generic, synthetic entries (`example-*`), flagged `isExample`, covering every status. Nothing in them is a real product, minimum, rating or claim, and none promises a return. **The owner must replace them.** `cite()` refuses an example product when `NODE_ENV` is `production` (reason `example_product`), so a forgotten example can never reach a customer. Seed: `npx tsx scripts/registry/seed-examples.ts` (idempotent; leaves anything the owner already edited).

## Access

| Area | Who | What |
| --- | --- | --- |
| `settings-product-registry` | ADMIN only (view and manage) | the management screen and every action |
| `product-registry` | ADMIN, MANAGER, RM (view) | `/product-registry`: approved, in-date products and their facts, read only |
| `product-registry-claims` | ADMIN, MARKETING (view) | `/marketing/approved-claims`: approved, in-date claims and the product name, nothing else |

MARKETING never gets a customer-group area, and the desk roles never get a marketing-group area (the segregation tests still pass). The Marketing loader `listApprovedClaims()` returns six fields only: product id and name, claim id and text, valid-until, example flag.

## Not built yet

Per-jurisdiction rule evaluation, automatic eligibility checks against a customer (the Decision Engine will consume `facts.eligibility`), document expiry reminders, a diff view between versions, and bulk import.
