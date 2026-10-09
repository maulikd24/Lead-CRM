import { AlertTriangle, BadgeCheck, CircleSlash, Clock, Handshake, LifeBuoy, PieChart, Radar, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AcceptanceChip, Callout } from "@/lib/c360/acceptance";
import type { ConsentStatus } from "@/lib/c360/consent";
import type { KeyDates } from "@/lib/c360/key-dates";
import type { IntelligenceView } from "@/lib/intelligence/view";
import { cn } from "@/lib/utils";

import { KeyDatesTrack } from "./key-dates-track";
import { PortfolioRing } from "./portfolio-ring";

export function RailCard({ title, description, icon: Icon, children, labelId }: { title: string; description?: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; labelId: string }) {
  return (
    <Card role="region" aria-labelledby={labelId} className="c360-rise">
      <CardHeader>
        <CardTitle id={labelId} className="flex items-center gap-2 text-base">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function RailError({ what }: { what: string }) {
  return (
    <Card role="alert" className="border-destructive/30">
      <CardContent className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium">Couldn&apos;t load {what}</p>
          <p className="mt-1 text-sm text-muted-foreground">The rest of the page is unaffected. Reload to try again; if it keeps failing, tell an Admin.</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RailSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <span className="sr-only" role="status">Loading {label}</span>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${95 - ((i * 13) % 40)}%` }} />
        ))}
      </CardContent>
    </Card>
  );
}

export function TimelineSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="grid gap-5">
        <span className="sr-only" role="status">Loading timeline</span>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ---- left rail ---------------------------------------------------------------------------------------------------

const asOf = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export type LeftRailData = { aum: number; asOfIso: string | null; holdingCount: number; allocation: { label: string; value: number }[]; callouts: Callout[]; chips: AcceptanceChip[] | null };

export function PortfolioCardView({ data, staticRender }: { data: LeftRailData; staticRender?: boolean }) {
  return (
    <RailCard labelId="c360-portfolio" title="Portfolio" icon={PieChart} description={data.holdingCount > 0 ? `${data.holdingCount} holding${data.holdingCount === 1 ? "" : "s"}, latest snapshot per holding` : undefined}>
      {data.allocation.length === 0 ? (
        <Empty title="No holdings yet" hint="Holdings appear here once the portfolio feed or an import brings them in." />
      ) : (
        <div className="grid gap-5">
          <PortfolioRing rows={data.allocation} aum={data.aum} asOfLabel={asOf(data.asOfIso)} staticRender={staticRender} />
          {data.callouts.length > 0 && (
            <ul className="grid gap-2" aria-label="Portfolio callouts">
              {data.callouts.map((c) => (
                <li key={c.key} title={c.hint} className={cn("flex items-center justify-between rounded-md border px-3 py-2 text-sm", c.tone === "warning" ? "border-warning/50 bg-warning/10" : "border-border bg-muted/40")}>
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="font-medium">{c.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </RailCard>
  );
}

const HEAT_STYLE = {
  3: "border-primary/60 bg-primary/15",
  2: "border-warning/50 bg-warning/10",
  1: "border-border bg-muted/50",
} as const;

export function AcceptanceCardView({ chips }: { chips: AcceptanceChip[] | null }) {
  return (
    <RailCard labelId="c360-acceptance" title="Acceptance" icon={Radar} description="How open this customer is to each asset class. Hover or focus a chip for the reason.">
      {chips === null ? (
        <Empty title="Not available right now" hint="Acceptance is computed with the customer's intelligence, which could not be loaded." />
      ) : chips.length === 0 ? (
        <Empty title="No acceptance data yet" />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const id = `acc-${chip.assetClass.replace(/\W+/g, "-").toLowerCase()}`;
            return (
              <li key={chip.assetClass} className="group relative">
                <button type="button" aria-describedby={id} aria-label={chip.label} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", HEAT_STYLE[chip.heat])}>
                  <span aria-hidden="true" className="flex items-end gap-0.5">
                    {[1, 2, 3].map((n) => (
                      <span key={n} className={cn("w-1 rounded-sm", n <= chip.heat ? "bg-foreground" : "bg-foreground/20")} style={{ height: 4 + n * 3 }} />
                    ))}
                  </span>
                  {chip.assetClass}
                  <span className="text-muted-foreground">{chip.levelLabel}</span>
                </button>
                <span id={id} role="tooltip" className="invisible absolute bottom-full left-0 z-20 mb-2 w-56 rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  {chip.reason}
                  {chip.isManual && <span className="mt-1 block text-muted-foreground">Set by an RM</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </RailCard>
  );
}

// ---- right rail --------------------------------------------------------------------------------------------------

export type RightRailData = {
  nba: IntelligenceView["nba"] | null;
  commitments: IntelligenceView["commitments"];
  issues: IntelligenceView["issues"];
  keyDates: KeyDates;
  consent: ConsentStatus;
  intelligenceAvailable: boolean;
};

const PRIORITY_VARIANT: Record<string, "destructive" | "warning" | "outline"> = { High: "destructive", Medium: "warning", Low: "outline" };

export function NextActionCardView({ nba, available }: { nba: IntelligenceView["nba"] | null; available: boolean }) {
  return (
    <RailCard labelId="c360-nba" title="Next best action" icon={Sparkles}>
      {!nba ? (
        <Empty title={available ? "No action suggested" : "Not available right now"} hint={available ? undefined : "The customer's intelligence could not be loaded."} />
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-heading text-base font-semibold">{nba.action}</p>
            <Badge variant={PRIORITY_VARIANT[nba.priority] ?? "outline"}>{nba.priority}</Badge>
          </div>
          <p className="text-sm">{nba.programme}{nba.topic ? ` · ${nba.topic}` : ""}</p>
          <p className="text-sm text-muted-foreground">{nba.reason}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> {nba.timing} · owner {nba.owner}
          </p>
          {nba.doNotDiscuss.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                <CircleSlash className="size-3.5" /> Do not discuss
              </p>
              <ul className="mt-1.5 grid gap-1 text-sm">
                {nba.doNotDiscuss.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </RailCard>
  );
}

export function CommitmentsCardView({ commitments }: { commitments: IntelligenceView["commitments"] }) {
  return (
    <RailCard labelId="c360-commitments" title="Pending commitments" icon={Handshake}>
      {commitments.length === 0 ? (
        <Empty title="Nothing promised and still open" />
      ) : (
        <ul className="grid gap-3">
          {commitments.map((c) => (
            <li key={c.id} className="text-sm">
              <p>{c.text}</p>
              <p className={cn("mt-0.5 text-xs", c.overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
                {c.dueAtIso ? `${c.overdue ? "Overdue, was due" : "Due"} ${asOf(c.dueAtIso)}` : "No due date"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </RailCard>
  );
}

export function KeyDatesCardView({ keyDates, staticRender }: { keyDates: KeyDates; staticRender?: boolean }) {
  return (
    <RailCard labelId="c360-dates" title="Key dates" icon={BadgeCheck}>
      <KeyDatesTrack data={keyDates} staticRender={staticRender} />
    </RailCard>
  );
}

export function TicketsPlaceholderCard({ openIssues }: { openIssues: IntelligenceView["issues"] }) {
  return (
    <RailCard labelId="c360-tickets" title="Support tickets" icon={LifeBuoy}>
      {openIssues.length > 0 && (
        <ul className="mb-3 grid gap-2">
          {openIssues.map((i) => (
            <li key={i.id} className="rounded-md border border-warning/50 bg-warning/10 p-2.5 text-sm">
              {i.text}
              <span className="mt-0.5 block text-xs text-muted-foreground">{i.kind.replace(/_/g, " ").toLowerCase()} · {asOf(i.dateIso)}</span>
            </li>
          ))}
        </ul>
      )}
      <Empty title="Ticket history is connected later" hint="Tickets from the helpdesk will list here once that connection is switched on. Issues raised in calls and chats show above." />
    </RailCard>
  );
}

export function ConsentCardView({ consent }: { consent: ConsentStatus }) {
  return (
    <RailCard labelId="c360-consent" title="Consent and contact" icon={ShieldCheck}>
      <dl className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Marketing consent</dt>
          <dd>{consent.marketing === "given" ? <Badge variant="success">Given {asOf(consent.consentAtIso)}</Badge> : <Badge variant="outline">Not recorded</Badge>}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Sales messages</dt>
          <dd>{consent.salesPaused ? <Badge variant="warning">Paused: open issue</Badge> : <Badge variant="outline">Allowed</Badge>}</dd>
        </div>
        {consent.doNotPitch && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Pitching</dt>
            <dd><Badge variant="destructive">Do not pitch</Badge></dd>
          </div>
        )}
      </dl>
    </RailCard>
  );
}
