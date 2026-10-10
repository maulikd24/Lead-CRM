import Link from "next/link";
import { CheckCircle2, CircleAlert, PlugZap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { CONTRACT_CHECKS, CONTRACT_COMMAND, type buildContractVM } from "@/lib/partners/status";

const TONE = { default: "text-foreground", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;
const enter = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** The Contract check section: where the connection stands, what to do next, and what "verified" stands for. Read-only: the mark itself is recorded in Settings. */
export function ContractView({ vm }: { vm: ReturnType<typeof buildContractVM> }) {
  const Icon = vm.status.key === "verified" ? CheckCircle2 : vm.status.key === "not_connected" || vm.status.key === "sample" ? PlugZap : CircleAlert;
  return (
    <div className="flex flex-col gap-4">
      <Card className={motion.enter}>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={cn("flex items-center gap-2 font-heading text-xl font-semibold", TONE[vm.status.tone])}>
              <Icon aria-hidden className="size-5" />
              {vm.status.label}
            </p>
            <p className="text-xs text-muted-foreground">Contract version <span className="font-mono">{vm.version}</span>{vm.verifiedOn ? ` · verified on ${vm.verifiedOn}` : ""}</p>
          </div>
          <p className="text-sm text-muted-foreground">{vm.status.hint}</p>
        </CardContent>
      </Card>

      <Card className={motion.enter} style={enter(1)}>
        <CardHeader>
          <CardTitle className="text-base">What to do next</CardTitle>
          <CardDescription className="max-lg:hidden">The field names the pages read are proposed, not confirmed. Verification is how they become trusted.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {vm.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {vm.canOpenSettings && (
            <Link href="/settings/integrations?tab=data" className="w-fit text-sm font-medium underline underline-offset-4">Open Apps and Integrations</Link>
          )}
          <div>
            <p className="mb-1 text-xs text-muted-foreground">The check sends only GET requests and never prints a value from a response. The token comes from the environment.</p>
            <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs"><code>{CONTRACT_COMMAND}</code></pre>
          </div>
        </CardContent>
      </Card>

      <Card className={motion.enter} style={enter(2)}>
        <CardHeader className="max-lg:hidden"><CardTitle className="text-base">What the check covers</CardTitle></CardHeader>
        <CardContent className="max-lg:py-0">
          {/* Phone: collapsed under one line; a native details element, so no script and no button. */}
          <details className="group lg:hidden">
            <summary className="cursor-pointer list-none py-1 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">What the check covers ({CONTRACT_CHECKS.length})</summary>
            <dl className="mt-2 grid gap-y-3 text-sm">
              {CONTRACT_CHECKS.map((c) => (
                <div key={c.title}>
                  <dt className="font-medium">{c.title}</dt>
                  <dd className="text-muted-foreground">{c.detail}</dd>
                </div>
              ))}
            </dl>
          </details>
          <dl className="hidden gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid">
            {CONTRACT_CHECKS.map((c) => (
              <div key={c.title}>
                <dt className="font-medium">{c.title}</dt>
                <dd className="text-muted-foreground">{c.detail}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
