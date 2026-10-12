import type { ReactNode } from "react";

/**
 * The title block for a workspace header: page title, one line of context (hidden on a phone to save height) and optional
 * `actions` at the end. Goes in the `header` slot of <WorkspaceShell>.
 */
export function WorkspaceHeading({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">{title}</h1>
          {description && <p className="hidden text-sm text-muted-foreground sm:block">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </>
  );
}
