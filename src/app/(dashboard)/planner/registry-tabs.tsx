import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/planner/inline-actions";
import { ActionForm, type FormField } from "@/components/planner/action-form";
import { RoutingTester } from "@/components/planner/routing-tester";
import { DESTINATION_KINDS, KIND_LABEL, STATUS_LABEL } from "@/lib/planner/destinations";
import { audienceViews, listCreators, listDestinations, listPeople, loadRules } from "@/lib/planner/db";
import { plannerHref } from "@/lib/planner/tabs";
import { isRegisteredCreator } from "@/lib/planner/workflow";

import { deleteRuleAction, previewRoutingAction, runHealthChecksAction, saveCreatorAction, saveDestinationAction, saveRuleAction } from "./actions";
import { Empty, NotLiveBadge } from "./ui";

const dt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) : "Never");
const AdminNote = () => <p className="text-xs text-muted-foreground">Only an Admin can change this registry. You can read it.</p>;

/** Where campaigns land. Registered here with a health check and a 'not live yet' flag; the tools behind them are built by the app team. */
export async function DestinationsTab({ edit, canEdit }: { edit?: string; canEdit: boolean }) {
  const [rows, people] = await Promise.all([listDestinations(), listPeople("plan-owner")]);
  const fields: FormField[] = [
    { name: "name", label: "Name", required: true, maxLength: 100 },
    { name: "kind", label: "Kind", type: "select", options: DESTINATION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) },
    { name: "urlPattern", label: "URL", required: true, maxLength: 500, help: "https for a page, a custom app scheme or https link for an app screen, a wa.me link with the number for WhatsApp." },
    { name: "status", label: "Status", type: "select", options: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })), help: "A destination that is planned or off can be attached to a plan but cannot be approved until it is live." },
    { name: "ownerId", label: "Owner", type: "select", options: [{ value: "", label: "Nobody yet" }, ...people.map((p) => ({ value: p.id, label: p.name }))] },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const editing = !canEdit ? null : edit === "new" ? { id: null as string | null, row: { kind: "WEB_LANDING", status: "PLANNED" } as Record<string, unknown> } : rows.find((r) => r.id === edit) ? { id: edit as string, row: rows.find((r) => r.id === edit) as unknown as Record<string, unknown> } : null;
  return (
    <div className="grid gap-4">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={plannerHref("destinations", { edit: "new" })} className="text-primary underline-offset-4 hover:underline">Add a destination</Link>
          <ActionButton variant="outline" label="Run health checks now" pendingLabel="Checking" action={runHealthChecksAction} />
        </div>
      ) : <AdminNote />}
      {editing && (
        <section aria-label="Destination form" className="rounded-lg border p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold">{editing.id ? "Edit destination" : "New destination"}</h2>
          <ActionForm label="Destination" fields={fields} initial={editing.row} action={(v) => saveDestinationAction(editing.id, v)} redirectTo={() => plannerHref("destinations")} />
        </section>
      )}
      {rows.length === 0 ? <Empty>No destinations registered yet. Register the app screens, landing pages and WhatsApp chats campaigns can land on.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Destinations">
          {rows.map((d) => (
            <li key={d.id} className="grid content-start gap-1.5 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-heading font-semibold">{d.name}</h2><span className="flex flex-wrap gap-1"><Badge variant="outline">{KIND_LABEL[d.kind as keyof typeof KIND_LABEL] ?? d.kind}</Badge><NotLiveBadge status={d.status} />{d.status === "LIVE" ? <Badge variant="success">Live</Badge> : null}</span></div>
              <p className="break-all text-xs text-muted-foreground">{d.urlPattern}</p>
              <p className="text-xs"><span className={d.lastCheckOk === false ? "font-medium text-destructive" : d.lastCheckOk ? "text-success" : "text-muted-foreground"}>{d.lastCheckOk == null ? "Not checked yet" : d.lastCheckOk ? "Healthy" : "Not healthy"}</span> <span className="text-muted-foreground">{d.lastCheckMessage ? `${d.lastCheckMessage} ` : ""}Checked {dt(d.lastCheckedAt)}. Used by {d._count.plans} plan{d._count.plans === 1 ? "" : "s"}.</span></p>
              {canEdit && <Link href={plannerHref("destinations", { edit: d.id })} className="text-xs text-primary underline-offset-4 hover:underline">Edit</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Short-video creators. A creator without a valid SEBI registration number can never be attached to a plan: the block is in the plan rules, not just here. */
export async function CreatorsTab({ edit, canEdit }: { edit?: string; canEdit: boolean }) {
  const rows = await listCreators();
  const fields: FormField[] = [
    { name: "name", label: "Name", required: true, maxLength: 100 },
    { name: "handle", label: "Handle", required: true, maxLength: 100 },
    { name: "platform", label: "Platform", maxLength: 40, placeholder: "YouTube" },
    { name: "sebiRegistration", label: "SEBI registration number", maxLength: 20, help: "Looks like INH000012345 (three letters, then nine digits). Leave empty if none: such a creator can never be used." },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const editing = !canEdit ? null : edit === "new" ? { id: null as string | null, row: {} as Record<string, unknown> } : rows.find((r) => r.id === edit) ? { id: edit as string, row: rows.find((r) => r.id === edit) as unknown as Record<string, unknown> } : null;
  return (
    <div className="grid gap-4">
      {canEdit ? <div><Link href={plannerHref("creators", { edit: "new" })} className="text-sm text-primary underline-offset-4 hover:underline">Add a creator</Link></div> : <AdminNote />}
      {editing && (
        <section aria-label="Creator form" className="rounded-lg border p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold">{editing.id ? "Edit creator" : "New creator"}</h2>
          <ActionForm label="Creator" fields={fields} initial={editing.row} action={(v) => saveCreatorAction(editing.id, v)} redirectTo={() => plannerHref("creators")} />
        </section>
      )}
      <p className="text-xs text-muted-foreground">Regulated firms may only work with creators who hold a SEBI registration. An unregistered creator is blocked from every plan.</p>
      {rows.length === 0 ? <Empty>No creators registered yet.</Empty> : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Creators">
          {rows.map((c) => {
            const ok = isRegisteredCreator(c);
            return (
              <li key={c.id} className="grid content-start gap-1 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-heading font-semibold">{c.name}</h2><Badge variant={ok ? "success" : "destructive"}>{ok ? "SEBI registered" : "Blocked: no SEBI registration"}</Badge></div>
                <p className="text-xs text-muted-foreground">{c.handle} on {c.platform}. {c.sebiRegistration ? `Registration ${c.sebiRegistration}.` : "No registration number."} Used by {c._count.plans} plan{c._count.plans === 1 ? "" : "s"}.</p>
                {canEdit && <Link href={plannerHref("creators", { edit: c.id })} className="text-xs text-primary underline-offset-4 hover:underline">Edit</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Routing rules: who owns a lead that arrives with a campaign code, by city, language, product and audience. First match wins; the fallback catches the rest. */
export async function RoutingTab({ edit, canEdit }: { edit?: string; canEdit: boolean }) {
  const [rules, owners, audiences] = await Promise.all([loadRules(), listPeople("lead-owner"), audienceViews()]);
  const ownerName = Object.fromEntries(owners.map((o) => [o.id, o.name]));
  const fields: FormField[] = [
    { name: "name", label: "Rule name", required: true, maxLength: 80 },
    { name: "priority", label: "Priority", type: "number", help: "Lower numbers are checked first." },
    { name: "audienceKey", label: "Audience", type: "select", options: [{ value: "", label: "Any" }, ...audiences.filter((a) => !a.archived).map((a) => ({ value: a.key, label: a.name }))] },
    { name: "cities", label: "Cities (one per line)", type: "lines" },
    { name: "languages", label: "Languages (one per line)", type: "lines" },
    { name: "products", label: "Products or tools (one per line)", type: "lines" },
    { name: "ownerId", label: "Owner", type: "select", options: [{ value: "", label: "Nobody yet" }, ...owners.map((o) => ({ value: o.id, label: o.name }))], help: "Someone who works with customers. Leads cannot be routed to anyone else." },
    { name: "ownerLabel", label: "Desk label", maxLength: 60, placeholder: "NRI desk" },
    { name: "isFallback", label: "This is the fallback rule", type: "checkbox", help: "Used only when no other rule matches. Only one rule is the fallback." },
    { name: "enabled", label: "Switched on", type: "checkbox" },
  ];
  const editing = !canEdit ? null : edit === "new" ? { id: null as string | null, row: { priority: 100, enabled: true } as Record<string, unknown> } : rules.find((r) => r.id === edit) ? { id: edit as string, row: rules.find((r) => r.id === edit) as unknown as Record<string, unknown> } : null;
  return (
    <div className="grid gap-4">
      {canEdit ? <div><Link href={plannerHref("routing", { edit: "new" })} className="text-sm text-primary underline-offset-4 hover:underline">Add a rule</Link></div> : <AdminNote />}
      {editing && (
        <section aria-label="Routing rule form" className="rounded-lg border p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold">{editing.id ? "Edit rule" : "New rule"}</h2>
          <ActionForm label="Routing rule" fields={fields} initial={editing.row} action={(v) => saveRuleAction(editing.id, v)} redirectTo={() => plannerHref("routing")} />
        </section>
      )}
      {rules.length === 0 ? <Empty>No routing rules yet. Leads that arrive with a campaign code follow the existing assignment until you add one.</Empty> : (
        <ol className="grid gap-2" aria-label="Routing rules in order">
          {rules.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading font-semibold">{r.name}</h2><span className="flex flex-wrap gap-1">{r.isFallback ? <Badge variant="accent">Fallback</Badge> : <Badge variant="outline">Priority {r.priority}</Badge>}{!r.enabled ? <Badge variant="secondary">Off</Badge> : null}</span></div>
              <p className="text-xs text-muted-foreground">{[r.audienceKey && `audience ${r.audienceKey}`, r.cities.length && `cities ${r.cities.join(", ")}`, r.languages.length && `languages ${r.languages.join(", ")}`, r.products.length && `products ${r.products.join(", ")}`].filter(Boolean).join("; ") || (r.isFallback ? "Everything that matched nothing else" : "No conditions yet")}. Owner: {r.ownerId ? ownerName[r.ownerId] ?? r.ownerLabel ?? "someone who no longer works with customers" : "nobody yet"}.</p>
              {canEdit && <div className="flex gap-3 text-xs"><Link href={plannerHref("routing", { edit: r.id })} className="text-primary underline-offset-4 hover:underline">Edit</Link><ActionButton size="sm" variant="outline" label="Delete" confirm={`Delete the rule "${r.name}"?`} action={() => deleteRuleAction(r.id)} /></div>}
            </li>
          ))}
        </ol>
      )}
      <RoutingTester test={previewRoutingAction as never} audiences={audiences.filter((a) => !a.archived).map((a) => ({ key: a.key, name: a.name }))} owners={ownerName} />
    </div>
  );
}
