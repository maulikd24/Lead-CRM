import { Ban } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** Renders nothing if there's no open blocker/exception; otherwise shows its reason. */
export function BlockerBadge({ reason }: { reason: string | null | undefined }) {
  if (!reason) return null;

  return (
    <Badge variant="destructive" title={reason} className="max-w-40">
      <Ban className="size-3" />
      <span className="truncate">{reason}</span>
    </Badge>
  );
}
