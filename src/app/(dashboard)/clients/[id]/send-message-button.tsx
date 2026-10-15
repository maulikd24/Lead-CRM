"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { MessageTemplate } from "@/generated/prisma/client";

// The composer's code is fetched only when someone opens it.
const SendMessagePanel = dynamic(() => import("./send-message-panel").then((m) => m.SendMessagePanel), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

/**
 * "Send message" as a button in the page header. Nothing of the composer loads until it is clicked, except when a link asks for it
 * (the Co-pilot's suggested message and the quick view's Message button open it straight away).
 */
export function SendMessageButton({ clientId, templates }: { clientId: string; templates: MessageTemplate[] }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(() => params.get("compose") === "1" || !!params.get("suggestTemplateId"));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <MessageSquare className="size-4" />
        Send message
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send message</DialogTitle>
        </DialogHeader>
        {open && <SendMessagePanel clientId={clientId} templates={templates} />}
      </DialogContent>
    </Dialog>
  );
}
