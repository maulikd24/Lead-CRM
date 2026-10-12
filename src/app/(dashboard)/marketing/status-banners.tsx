import { AlertTriangle, Info, XCircle } from "lucide-react";

import type { Banner } from "@/lib/marketing/view-model";
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
