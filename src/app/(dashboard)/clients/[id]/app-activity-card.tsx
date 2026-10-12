import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils/format";
import type { AppProfileResult } from "@/lib/integrations/clevertap/get-app-profile";
import { loadAppProfile } from "@/lib/integrations/clevertap/load-app-profile";
import { relativeTime } from "@/lib/integrations/clevertap/relative-time";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card role="region" aria-labelledby="app-campaigns-title">
      <CardHeader>
        <CardTitle id="app-campaigns-title" className="text-base">App and campaigns</CardTitle>
        <CardDescription>What CleverTap knows about this customer&apos;s app use. Read-only.</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AppActivityView({ result, now }: { result: AppProfileResult; now: Date }) {
  if ("error" in result) {
    const copy = {
      not_connected: ["CleverTap is not connected", "Ask an Admin to connect it in Settings."],
      rejected: ["CleverTap rejected the request", "Ask an Admin to check the connection in Settings."],
      busy: ["CleverTap is busy", "Try again shortly."],
      unreachable: ["Couldn't reach CleverTap", "Try again in a few minutes."],
    }[result.kind];
    return <Shell><Empty title={copy[0]} hint={copy[1]} /></Shell>;
  }
  if (!result.found) return <Shell><Empty title="No app profile found for this customer" /></Shell>;

  const avProps = Object.entries(result.properties).filter(([k]) => k.startsWith("av_")).sort(([a], [b]) => a.localeCompare(b));
  const rel = result.lastSeen ? relativeTime(result.lastSeen, now) : null;
  return (
    <Shell>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Platforms</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {result.platforms.length ? result.platforms.map((p) => <Badge key={p} variant="outline">{p}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last seen</dt>
          <dd className="mt-1 text-sm">
            {result.lastSeen ? (<><span className="font-medium">{rel}</span><span className="block text-xs text-muted-foreground">{formatDateTime(new Date(result.lastSeen))}</span></>) : <span className="text-muted-foreground">Unknown</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Push token registered</dt>
          <dd className="mt-1">
            {result.pushEnabled === null ? <Badge variant="outline">Unknown</Badge> : result.pushEnabled ? <Badge variant="accent">Yes</Badge> : <Badge variant="outline">No</Badge>}
          </dd>
        </div>
      </dl>
      {avProps.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs text-muted-foreground">Allvest signals sent to CleverTap</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {avProps.map(([k, v]) => (
              <li key={k}><Badge variant="secondary">{k.slice(3).replace(/_/g, " ")}: {String(v)}</Badge></li>
            ))}
          </ul>
        </div>
      )}
    </Shell>
  );
}

/** Server component: fetches on render, so mount it inside Suspense. Callers must only pass a client the viewer may already see. */
export async function AppActivityCard({ client }: { client: { id: string } }) {
  const result = await loadAppProfile(client).catch(() => ({ error: "CleverTap is unreachable", kind: "unreachable" }) as AppProfileResult);
  return <AppActivityView result={result} now={new Date()} />;
}

export function AppActivityCardSkeleton() {
  return (
    <Shell>
      <div aria-busy="true">
        <span className="sr-only" role="status">Loading app activity</span>
        <Skeleton className="h-12 w-full" />
      </div>
    </Shell>
  );
}
