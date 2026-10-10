import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import styles from "./consent.module.css";

/** Sits above the inbox composer. Information for the RM, not a block: they can still reply to what the customer asked. */
export function ConsentBanner({ text, className }: { text: string; className?: string }) {
  return (
    <div role="status" className={cn(styles.banner, "mb-2 flex items-start gap-2 rounded-md px-3 py-2 text-xs", className)}>
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}
