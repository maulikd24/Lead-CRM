import Link from "next/link";

import { InfoTip } from "@/components/shared/info-tip";
import { DEFINITIONS } from "@/lib/copilot/definitions";
import { cn } from "@/lib/utils";
import { CLIENT_LIST_SEGMENTS, activeClientSegment, clientSegmentHref } from "@/lib/clients/list-segments";

/** All / Onboarding / Customers / At risk / Disengaged — shortcuts for the status and SLA filters below. */
export function ClientSegmentTabs({ params }: { params: Record<string, string | undefined> }) {
  const active = activeClientSegment(params);
  return (
    <div className="flex w-fit items-center">
    <nav aria-label="Client segments" className="flex w-fit items-center gap-1 rounded-md border border-border p-0.5">
      {CLIENT_LIST_SEGMENTS.map((segment) => (
        <Link
          key={segment.key}
          href={clientSegmentHref(params, segment)}
          aria-current={active === segment.key ? "page" : undefined}
          className={cn(
            "rounded px-3 py-1.5 text-xs font-semibold transition-colors",
            active === segment.key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {segment.label}
        </Link>
      ))}
    </nav>
    <InfoTip label="Disengaged">{DEFINITIONS.disengaged}</InfoTip>
    </div>
  );
}
