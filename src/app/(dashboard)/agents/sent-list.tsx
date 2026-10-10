import { Send } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "@/components/workspace";

export type SentRow = { id: string; clientName: string; clientCode: string; programme: string | null; body: string; edited: boolean; by: string | null; at: string };

/** Recently sent agent drafts: who approved, when, and whether the text was edited first. Read only. */
export function SentList({ rows }: { rows: SentRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={Send} title="Nothing sent yet" description="Drafts appear here after a person approves and sends them." />
        </CardContent>
      </Card>
    );
  }
  return (
    <ul aria-label="Sent drafts" className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={r.id} className={motion.enter} style={{ ["--i" as string]: i }}>
          <Card size="sm">
            <CardContent className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-semibold">{r.clientName}</span>
                <span className="text-xs text-muted-foreground">{r.clientCode}</span>
                {r.programme && <span className="text-xs text-muted-foreground">{r.programme}</span>}
                {r.edited && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Edited before sending</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{r.by ? `${r.by} · ` : ""}{r.at}</span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{r.body}</p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
