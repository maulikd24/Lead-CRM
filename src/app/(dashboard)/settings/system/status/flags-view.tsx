import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FlagRow, FlagsPanelData } from "@/lib/flags/panel";
import type { Kind } from "@/lib/flags/types";

/**
 * The Flags tab: every feature flag and environment setting, what it is right now, its default, what it depends on, what
 * breaks the combination, and how the environment compares with the five named profiles. Read only: nothing here changes a
 * flag (a flag is set in the host's environment and a NEXT_PUBLIC_* one needs a rebuild). Secrets show "set" or "not set".
 */

const GROUPS: { kinds: Kind[]; title: string; open: boolean }[] = [
  { kinds: ["feature"], title: "Features and screens", open: true },
  { kinds: ["outbound", "outbound-ai"], title: "Outbound and AI-adjacent", open: true },
  { kinds: ["safety", "blocked"], title: "Safety switches and blocked flags", open: true },
  { kinds: ["config"], title: "Settings", open: false },
  { kinds: ["secret"], title: "Credentials (presence only)", open: false },
  { kinds: ["platform"], title: "Host-provided", open: false },
  { kinds: ["test"], title: "Tests and tooling", open: false },
];

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <p className="font-heading text-lg font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Now({ row }: { row: FlagRow }) {
  const e = row.effective;
  const badge =
    e.state === "on" ? <Badge variant="success">On</Badge>
    : e.state === "invalid" ? <Badge variant="warning">Invalid (reads as off)</Badge>
    : e.state === "set" ? <Badge variant="secondary">Set</Badge>
    : e.state === "value" ? <Badge variant="secondary" className="max-w-48 truncate font-mono">{e.value}</Badge>
    : e.state === "default" ? <Badge variant="outline">Default: {e.value}</Badge>
    : <Badge variant="outline">{e.state === "not set" ? "Not set" : "Off"}</Badge>;
  return (
    <div className="flex flex-col items-start gap-1">
      {badge}
      {row.setAt === "build" && <span className="text-xs text-muted-foreground">set at build</span>}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">-</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {items.map((x) => (<li key={x}>{x}</li>))}
    </ul>
  );
}

function FlagTable({ rows }: { rows: FlagRow[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Flag</TableHead>
            <TableHead>Now</TableHead>
            <TableHead>Default</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Depends on</TableHead>
            <TableHead>Conflicts with</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell className="max-w-72 whitespace-normal">
                <span className="font-mono text-xs">{r.name}</span>
                {r.inFlight && <Badge variant="outline" className="ml-1">arrives with {r.inFlight}</Badge>}
                {r.blocked && <Badge variant="destructive" className="ml-1">blocked</Badge>}
                {r.approval && <Badge variant="warning" className="ml-1">needs approval</Badge>}
                <p className="text-xs text-muted-foreground">{r.enables}</p>
                {r.findings.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                    {r.findings.map((f) => (<li key={f.rule + f.message} className={f.severity === "error" ? "text-destructive" : "text-warning"}>{f.rule}: {f.message}</li>))}
                  </ul>
                )}
              </TableCell>
              <TableCell><Now row={r} /></TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.default}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.owner}</TableCell>
              <TableCell className="max-w-64 whitespace-normal"><List items={r.dependsOn} /></TableCell>
              <TableCell className="max-w-64 whitespace-normal"><List items={r.conflictsWith} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function FlagsPanel({ data }: { data: FlagsPanelData }) {
  const { summary, findings, profiles, rows, closestProfile } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5 lg:gap-4">
        <Fact label="Switches on" value={`${summary.on} of ${summary.switches}`} sub="Exactly 1 means on" />
        <Fact label="Set at build" value={summary.buildTimeOn} sub="On, and fixed until the next rebuild" />
        <Fact label="Rule errors" value={summary.errors} sub={summary.errors ? "Fix before relying on this setup" : "None"} />
        <Fact label="Rule warnings" value={summary.warnings} sub="Worth a look" />
        <Fact label="Closest profile" value={closestProfile} sub={`${summary.registered} names in the registry`} />
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Validation
            <Badge variant={summary.errors ? "destructive" : summary.warnings ? "warning" : "success"}>{summary.errors} errors, {summary.warnings} warnings</Badge>
          </CardTitle>
          <CardDescription>The registry rules applied to this environment. A production start stops only on the safety rules (FR-05, FR-10, FR-11, FR-13, FR-14); the rest are shown here. No value is ever printed.</CardDescription>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? <p className="text-sm text-muted-foreground">No rule is broken by this environment.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Flag</TableHead><TableHead>Problem</TableHead><TableHead>Fix</TableHead></TableRow></TableHeader>
                <TableBody>
                  {findings.map((f) => (
                    <TableRow key={f.rule + f.flag + f.message}>
                      <TableCell><Badge variant={f.severity === "error" ? "destructive" : "warning"}>{f.rule}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{f.flag}</TableCell>
                      <TableCell className="max-w-96 whitespace-normal text-sm">{f.message}</TableCell>
                      <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">{f.fix}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Profile comparison</CardTitle>
          <CardDescription>How this environment differs from each named profile (docs/profiles). Flags that wait for an owner approval are listed apart, not counted as missing.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profile</TableHead>
                  <TableHead>Matches</TableHead>
                  <TableHead>On here, not in the profile</TableHead>
                  <TableHead>In the profile, off here</TableHead>
                  <TableHead>Waits for approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell className="max-w-64 whitespace-normal">
                      <span className="font-medium">{p.name}</span>
                      {p.name === closestProfile && <Badge variant="accent" className="ml-1">closest</Badge>}
                      <p className="text-xs text-muted-foreground">{p.purpose}</p>
                    </TableCell>
                    <TableCell className="text-sm">{p.matches} of {p.total}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal"><List items={p.extraHere} /></TableCell>
                    <TableCell className="max-w-64 whitespace-normal"><List items={p.missingHere} /></TableCell>
                    <TableCell className="max-w-64 whitespace-normal"><List items={p.pendingApproval} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>All flags and settings</CardTitle>
          <CardDescription>
            Read only. A flag starting NEXT_PUBLIC_ is labelled set at build: the value shown is the environment now, and a change shows on screens only after a rebuild and redeploy. Names that arrive with an unmerged branch are marked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {GROUPS.map((g) => {
            const list = rows.filter((r) => g.kinds.includes(r.kind));
            if (list.length === 0) return null;
            const on = list.filter((r) => r.effective.state === "on").length;
            return (
              <details key={g.title} open={g.open} className="rounded-lg border border-border">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
                  <span>{g.title}</span>
                  <span className="text-xs font-normal text-muted-foreground">{list.length} names{on ? `, ${on} on` : ""}</span>
                </summary>
                <div className="border-t border-border p-2"><FlagTable rows={list} /></div>
              </details>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
