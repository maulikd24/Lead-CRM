import { can, type Area } from "@/lib/access/policy";
import type { PartnerScope } from "@/lib/partners/native/scope";
import type { NavFlag } from "@/lib/nav-flags";
import type { Role } from "@/generated/prisma/client";

/**
 * Cmd+K universal search. The rule it never breaks: every source is gated by the SAME central policy registry as the page it leads to,
 * checked BEFORE the source is queried, and every query receives the same scope the page's loader uses (visible users, partner sub-tree).
 * A role that may not open a screen cannot find anything that lives on it, and a source whose feature flag is off answers nobody.
 */
export type SearchKind = "customer" | "task" | "ticket" | "partner" | "campaign";

export const SEARCH_SOURCES: Record<SearchKind, { area: Area; label: string; flag?: NavFlag }> = {
  customer: { area: "clients", label: "Customers" },
  task: { area: "tasks", label: "Tasks" },
  ticket: { area: "client-support", label: "Tickets" },
  partner: { area: "partner-workspace", label: "Partners", flag: "partner-workspace" },
  campaign: { area: "marketing", label: "Campaigns", flag: "marketing" },
};

export type SearchHit = { kind: SearchKind; key: string; label: string; sublabel: string; href: string };
type Actor = { id: string; role: Role };

/** What the sources read. The server action implements these with Prisma; tests fake them to prove what is and is not called. */
export type SearchDeps = {
  visibleUserIds(actor: Actor): Promise<string[] | null>;
  partnerScope(actor: Actor): Promise<PartnerScope | null>;
  customers(q: string, visible: string[] | null): Promise<{ id: string; name: string; clientCode: string; mobile: string | null }[]>;
  tasks(q: string, actor: Actor, visible: string[] | null): Promise<{ id: string; title: string; status: string; dueAt: Date; clientId: string; clientName: string }[]>;
  tickets(q: string, visible: string[] | null): Promise<{ id: string; subject: string | null; clientId: string; clientName: string }[]>;
  partners(q: string, scope: PartnerScope): Promise<{ id: string; code: string; name: string }[]>;
  campaigns(q: string): Promise<{ name: string; provider: string }[]>;
};

const PER_SOURCE = 4;
/** For a role that may not see customers: the task title with the customer's name taken out. */
const redactName = (title: string, name: string) => (name.trim() ? title.split(new RegExp(name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join("a customer") : title);
const dueLabel = (d: Date) => `Due ${d.toISOString().slice(0, 10)}`;

export async function universalSearch(actor: Actor, query: string, enabledFlags: readonly string[], deps: SearchDeps): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const allowed = (kind: SearchKind) => {
    const s = SEARCH_SOURCES[kind];
    return can(actor.role, s.area, "view") && (!s.flag || enabledFlags.includes(s.flag));
  };
  const needsVisible = (["customer", "task", "ticket"] as const).some(allowed);
  const visible = needsVisible ? await deps.visibleUserIds(actor) : null;
  // A failing source must never take the others (or the palette) down.
  const safe = async <T>(run: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await run();
    } catch {
      return [];
    }
  };

  const [customers, tasks, tickets, partners, campaigns] = await Promise.all([
    allowed("customer") ? safe(() => deps.customers(q, visible)) : Promise.resolve([]),
    allowed("task") ? safe(() => deps.tasks(q, actor, visible)) : Promise.resolve([]),
    allowed("ticket") ? safe(() => deps.tickets(q, visible)) : Promise.resolve([]),
    allowed("partner")
      ? safe(async () => {
          const scope = await deps.partnerScope(actor);
          return scope ? deps.partners(q, scope) : [];
        })
      : Promise.resolve([]),
    allowed("campaign") ? safe(() => deps.campaigns(q)) : Promise.resolve([]),
  ]);

  // A role that works on tasks without seeing customers (marketing) gets the task alone: no customer name, no link into a customer.
  const mayOpenCustomers = can(actor.role, "clients", "view");
  return [
    ...customers.slice(0, PER_SOURCE).map((c): SearchHit => ({ kind: "customer", key: c.id, label: c.name, sublabel: `${c.clientCode} · ${c.mobile ?? "no phone"}`, href: `/clients/${c.id}` })),
    ...tasks.slice(0, PER_SOURCE).map(
      (t): SearchHit => ({
        kind: "task",
        key: t.id,
        label: mayOpenCustomers ? t.title : redactName(t.title, t.clientName),
        sublabel: mayOpenCustomers ? `${t.clientName} · ${dueLabel(t.dueAt)}` : dueLabel(t.dueAt),
        href: mayOpenCustomers ? `/clients/${t.clientId}` : "/tasks",
      }),
    ),
    ...tickets.slice(0, PER_SOURCE).map((t): SearchHit => ({ kind: "ticket", key: t.id, label: t.subject ?? "Support ticket", sublabel: t.clientName, href: `/clients/${t.clientId}` })),
    ...partners.slice(0, PER_SOURCE).map((p): SearchHit => ({ kind: "partner", key: p.id, label: p.name, sublabel: p.code, href: `/partners?q=${encodeURIComponent(p.code)}` })),
    ...campaigns.slice(0, PER_SOURCE).map((c): SearchHit => ({ kind: "campaign", key: `${c.provider}:${c.name}`, label: c.name, sublabel: `${c.provider} campaign`, href: "/marketing?tab=campaigns" })),
  ];
}
