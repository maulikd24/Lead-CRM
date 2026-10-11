import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/planner/inline-actions";
import { ActionForm, type FormField } from "@/components/planner/action-form";
import { CHANNELS, CHANNEL_KEYS } from "@/lib/planner/channels";
import { listAudiences, listDestinations, listPromises, productStates } from "@/lib/planner/db";
import { checkPromise } from "@/lib/planner/guardrails";
import { NEEDS_REGISTRY_TEXT } from "@/lib/planner/product-citation";
import { plannerHref } from "@/lib/planner/tabs";

import { saveAudienceAction, savePromiseAction, setAudienceArchivedAction, setPromiseArchivedAction } from "./actions";
import { Empty, NotLiveBadge } from "./ui";

const audienceFields: FormField[] = [
  { name: "name", label: "Name", required: true, maxLength: 80 },
  { name: "description", label: "Who they are", type: "textarea", required: true },
  { name: "languages", label: "Languages (one per line)", type: "lines" },
  { name: "cities", label: "Cities (one per line)", type: "lines" },
  { name: "channels", label: "Typical channels", type: "lines", help: `Use these keys, one per line: ${CHANNEL_KEYS.join(", ")}.` },
  { name: "tone", label: "Tone", type: "textarea" },
  { name: "productFit", label: "What fits them", type: "textarea" },
  { name: "objections", label: "Likely objections", type: "textarea" },
  { name: "complianceNote", label: "Compliance note", type: "textarea", help: "What marketing must be careful about for this audience." },
];

/** Audiences are editable; archiving keeps old plans readable. */
export async function AudiencesTab({ edit }: { edit?: string }) {
  const audiences = await listAudiences();
  const editing = edit === "new" ? { id: null, row: null } : audiences.find((a) => a.id === edit) ? { id: edit as string, row: audiences.find((a) => a.id === edit)! } : null;
  return (
    <div className="grid gap-4">
      {editing ? (
        <section aria-label={editing.id ? "Edit audience" : "New audience"} className="rounded-lg border p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold">{editing.id ? `Edit ${editing.row?.name}` : "New audience"}</h2>
          <ActionForm label="Audience" fields={audienceFields} initial={editing.row ?? undefined} action={(v) => saveAudienceAction(editing.id, v)} redirectTo={() => plannerHref("audiences")} />
        </section>
      ) : <div><Link href={plannerHref("audiences", { edit: "new" })} className="text-sm text-primary underline-offset-4 hover:underline">Add an audience</Link></div>}
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Audiences">
        {audiences.map((a) => (
          <li key={a.id} className="grid content-start gap-1.5 rounded-lg border p-3 text-sm">
            <div className="flex items-start justify-between gap-2"><h2 className="font-heading font-semibold">{a.name}</h2>{a.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}</div>
            <p className="line-clamp-3 text-muted-foreground">{a.description}</p>
            <p className="text-xs"><span className="text-muted-foreground">Channels: </span>{a.channels.map((c) => CHANNELS[c as keyof typeof CHANNELS]?.label ?? c).join(", ") || "None set"}</p>
            <p className="text-xs"><span className="text-muted-foreground">Cities: </span>{a.cities.slice(0, 4).join(", ") || "None set"}{a.cities.length > 4 ? "..." : ""}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <Link href={plannerHref("audiences", { edit: a.id })} className="text-primary underline-offset-4 hover:underline">Edit</Link>
              <ActionButton size="sm" variant="outline" label={a.archivedAt ? "Restore" : "Archive"} action={() => setAudienceArchivedAction(a.id, !a.archivedAt)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The promise library: each promise with its SEBI and ASCI checklist as visible pass or fail items (never one score). */
export async function PromisesTab({ edit }: { edit?: string }) {
  const [promises, destinations] = await Promise.all([listPromises(), listDestinations()]);
  const states = await productStates(promises);
  const promiseFields: FormField[] = [
    { name: "hook", label: "The promise (hook)", required: true, maxLength: 200, help: "One calm line a person would read. No returns, no advice, no urgency." },
    { name: "evidence", label: "What proves it", type: "textarea", required: true, help: "What the tool actually does and needs." },
    { name: "product", label: "The tool or product it leads to", required: true, maxLength: 120 },
    { name: "destinationId", label: "Destination", type: "select", options: [{ value: "", label: "None yet" }, ...destinations.map((d) => ({ value: d.id, label: `${d.name}${d.status === "LIVE" ? "" : " (not live yet)"}` }))] },
    { name: "allowedClaims", label: "Allowed claims (one per line)", type: "lines" },
    { name: "disallowedClaims", label: "Disallowed claims (one per line)", type: "lines" },
    { name: "mentionsProduct", label: "This promise names an investment product, scheme or fund", type: "checkbox", help: "Such a promise can only use wording the Product Registry has approved. No product is approved there yet, so it cannot be sent for review." },
    { name: "productRegistryId", label: "Product Registry id", maxLength: 80, help: "The registry id it cites. Leave empty if none." },
  ];
  const editing = edit === "new" ? { id: null as string | null, row: null } : promises.find((p) => p.id === edit) ? { id: edit as string, row: promises.find((p) => p.id === edit)! } : null;
  return (
    <div className="grid gap-4">
      {editing ? (
        <section aria-label={editing.id ? "Edit promise" : "New promise"} className="rounded-lg border p-4">
          <h2 className="mb-3 font-heading text-sm font-semibold">{editing.id ? "Edit promise" : "New promise"}</h2>
          <ActionForm label="Promise" fields={promiseFields} initial={editing.row ?? undefined} action={(v) => savePromiseAction(editing.id, v)} redirectTo={() => plannerHref("promises")} />
        </section>
      ) : <div><Link href={plannerHref("promises", { edit: "new" })} className="text-sm text-primary underline-offset-4 hover:underline">Add a promise</Link></div>}
      {promises.length === 0 ? <Empty>No promises yet.</Empty> : (
        <ul className="grid gap-3 xl:grid-cols-2" aria-label="Promise library">
          {promises.map((p) => {
            const check = checkPromise(p);
            const product = states.get(p.id);
            const failing = check.items.filter((i) => i.status === "fail");
            return (
              <li key={p.id} className="grid content-start gap-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-heading font-semibold">{p.hook}</h2>
                  <span className="flex flex-wrap gap-1">
                    {p.archivedAt ? <Badge variant="secondary">Archived</Badge> : null}
                    <Badge variant={check.ok ? "success" : "destructive"}>{check.ok ? "Checklist passes" : `${failing.length} to fix`}</Badge>
                    {product?.mentions && !product.cited ? <Badge variant="warning">Needs registry approval</Badge> : null}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Leads to {p.product}{p.destination ? ` on ${p.destination.name}` : ""} <NotLiveBadge status={p.destination?.status ?? "LIVE"} /></p>
                <ul className="grid gap-1 text-xs" aria-label={`Checklist for ${p.hook}`}>
                  {check.items.map((i) => <li key={i.id} className="flex gap-1.5"><span className={i.status === "pass" ? "text-success" : "text-destructive"} aria-label={i.status === "pass" ? "Pass" : "Fail"}>{i.status === "pass" ? "Pass" : "Fail"}</span><span><span className="font-medium">{i.label}.</span> <span className="text-muted-foreground">{i.detail}</span></span></li>)}
                  {product?.mentions && !product.cited ? <li className="flex gap-1.5"><span className="text-destructive" aria-label="Fail">Fail</span><span><span className="font-medium">Product claims cite the registry.</span> <span className="text-muted-foreground">{NEEDS_REGISTRY_TEXT}</span></span></li> : null}
                </ul>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <Link href={plannerHref("promises", { edit: p.id })} className="text-primary underline-offset-4 hover:underline">Edit</Link>
                  <ActionButton size="sm" variant="outline" label={p.archivedAt ? "Restore" : "Archive"} action={() => setPromiseArchivedAction(p.id, !p.archivedAt)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
