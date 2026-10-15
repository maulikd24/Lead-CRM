import { Badge } from "@/components/ui/badge";
import { ShowFirst } from "@/components/workspace";
import type { CategoryCard } from "@/lib/autopilot/scoring";
import { pct } from "@/lib/autopilot/stats";

import { SEVERITY_BADGE } from "./ui";

/** One card per category: the score, the evidence coverage that sits beside it, and the two findings that matter most. */
export function AuditTab({ cards }: { cards: CategoryCard[] }) {
  const items = cards.map((c) => (
        <div key={c.category} className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-heading text-sm font-bold">{c.category}</h2>
            <p className="text-right">
              <span className="text-2xl font-extrabold tabular-nums">{c.score === null ? "n/a" : c.score}</span>
              {c.score !== null ? <span className="text-xs text-muted-foreground"> / 100</span> : null}
            </p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Evidence coverage {pct(c.coverage)} ({c.judged} of {c.applicable} checks judged){c.score !== null && c.confidence !== "normal" ? ` - ${c.confidence === "provisional" ? "provisional" : "low confidence"}` : ""}
          </p>
          {c.score === null ? <p className="mt-2 text-xs text-muted-foreground">Not enough data to score this yet.</p> : null}
          <ul className="mt-3 space-y-2">
            {c.findings.length === 0 ? <li className="text-sm text-muted-foreground">Nothing to check here yet.</li> : null}
            {c.findings.map((f) => (
              <li key={f.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={f.state === "fail" ? SEVERITY_BADGE[f.severity] : f.state === "pass" ? "success" : "outline"}>{f.state === "fail" ? f.severity : f.state === "pass" ? "ok" : "unknown"}</Badge>
                  <span>{f.finding}</span>
                </div>
                {f.evidence.length ? <p className="mt-0.5 pl-0.5 text-xs text-muted-foreground">{f.evidence.slice(0, 2).join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        </div>
  ));
  return <ShowFirst name="audit" title="Audit by category" noun="categories" limit={3} items={items} as="div" className="lg:grid lg:grid-cols-2 2xl:grid-cols-3" />;
}
