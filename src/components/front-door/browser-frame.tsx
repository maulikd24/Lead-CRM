import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { SYNTHETIC_LABEL } from "@/lib/front-door/fixtures";

/** A browser-style frame around a product screen. Always says the content is synthetic. */
export function BrowserFrame({ url, children, className, tag = "Synthetic example", label }: { url: string; children: ReactNode; className?: string; tag?: string; label?: string }) {
  return (
    <figure className={cn("fd-frame m-0", className)} aria-label={label ?? SYNTHETIC_LABEL}>
      <div className="fd-frame-bar" aria-hidden="true">
        <span className="fd-frame-dots"><i /><i /><i /></span>
        <span className="fd-frame-url">{url}</span>
        <span className="fd-frame-tag">{tag}</span>
      </div>
      <div className="fd-frame-body">{children}</div>
    </figure>
  );
}
