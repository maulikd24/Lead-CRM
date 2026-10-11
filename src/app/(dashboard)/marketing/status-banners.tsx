import { AlertTriangle, Info, XCircle } from "lucide-react";

import { PhoneSheet } from "@/components/workspace";
import { summariseBanners, type Banner } from "@/lib/marketing/view-model";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: { cls: "border-border bg-muted/40 text-foreground", Icon: Info },
  warning: { cls: "border-warning/40 bg-warning/10 text-foreground", Icon: AlertTriangle },
  destructive: { cls: "border-destructive/40 bg-destructive/10 text-foreground", Icon: XCircle },
} as const;

export function StatusBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {banners.map((b, i) => {
        const { cls, Icon } = TONES[b.tone];
        return (
          <p key={i} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", cls)}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", b.tone === "warning" && "text-warning", b.tone === "destructive" && "text-destructive")} aria-hidden />
            <span>{b.text}</span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * The notices above a Marketing tab. One notice shows in place. Two or more fold into ONE dense row on a phone (the worst notice and how many
 * more), opening the full list in a sheet; from 1024px they all show in place, so nothing is lost on a laptop. Without this a degraded day
 * (failed sync, stale numbers, a switched-off channel, lead mismatches, on two channels) stacked seven notices and the Campaigns tab was 2.21
 * viewports tall on a phone against a budget of 1.7.
 */
export function CollapsingBanners({ banners }: { banners: Banner[] }) {
  const summary = summariseBanners(banners);
  if (!summary) return null;
  if (summary.count === 1) return <StatusBanners banners={banners} />;
  const { Icon } = TONES[summary.tone];
  return (
    <PhoneSheet
      name="status-notices"
      title={`${summary.count} notices about this data`}
      summary={summary.headline}
      badge={<Icon className={cn("size-4", summary.tone === "warning" && "text-warning", summary.tone === "destructive" && "text-destructive")} aria-hidden />}
      description="Sync state and data coverage. Figures are shown as the last sync left them."
    >
      <StatusBanners banners={banners} />
    </PhoneSheet>
  );
}
