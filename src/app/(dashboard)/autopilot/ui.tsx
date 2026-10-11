import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Severity } from "@/lib/autopilot/types";

/** Small shared pieces for the Autopilot tabs. */

export const SEVERITY_BADGE: Record<Severity, "destructive" | "warning" | "outline" | "secondary"> = { critical: "destructive", high: "warning", medium: "secondary", informational: "outline" };

export function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Shown wherever a dataset the platforms did not report would otherwise look like zero. */
export function NotAvailable({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"><Badge variant="outline" className="mr-2">Not available</Badge>{children}</p>;
}

export function DataAge({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">Data {text}. Limits shown as &ldquo;default&rdquo; are our starting values, not industry facts, and can be changed.</p>;
}

/** A horizontally scrollable table wrapper that keyboard users can reach and screen readers can name. */
export function ScrollBox({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto">{children}</div>;
}
