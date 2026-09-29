"use client";

import { useCallback, useState } from "react";
import { QrCode } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import type { AccountState } from "@/lib/whatsapp/account-state";
import { formatDateTime } from "@/lib/utils/format";
import { getWhatsAppAccountStateAction } from "./actions";

export const ACCOUNT_STATUS_VARIANT = {
  CONNECTED: "success",
  QR_PENDING: "warning",
  CONNECTING: "secondary",
  DISCONNECTED: "outline",
  FAILED: "destructive",
} as const;

export function AccountStatusBadge({ state }: { state: Pick<AccountState, "status" | "online"> }) {
  const label = state.status === "CONNECTED" && !state.online ? "STALE" : state.status.replace(/_/g, " ");
  const variant = state.status === "CONNECTED" && !state.online ? "warning" : ACCOUNT_STATUS_VARIANT[state.status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** Polls every 3s while mounted — mount it only while it's on screen (e.g. inside an open dialog). */
export function QrPanel({ initial }: { initial: AccountState }) {
  const [state, setState] = useState<AccountState>(initial);

  const refresh = useCallback(async () => {
    try {
      const next = await getWhatsAppAccountStateAction(initial.id);
      if (next) setState(next);
    } catch {
      // Keep showing the last known state; the next tick retries.
    }
  }, [initial.id]);

  useVisiblePoll(refresh, 3000);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <AccountStatusBadge state={state} />
      {state.qr ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a base64 data URL; next/image adds nothing here */}
          <img src={state.qr} alt={`WhatsApp QR code for ${state.label}`} className="size-60 rounded-lg border border-border bg-white p-2" />
          <p className="max-w-xs text-xs text-muted-foreground">
            On the phone with this number: WhatsApp → Settings → Linked devices → Link a device, then scan. The code refreshes automatically.
          </p>
        </>
      ) : state.status === "CONNECTED" ? (
        <p className="text-sm">
          Connected{state.phoneNumber ? ` as +${state.phoneNumber}` : ""}.
          {state.lastSeenAt ? <span className="block text-xs text-muted-foreground">Last seen {formatDateTime(new Date(state.lastSeenAt))}</span> : null}
        </p>
      ) : (
        <>
          <p className="max-w-xs text-sm text-muted-foreground">
            {state.status === "FAILED" && state.lastError
              ? `Session failed: ${state.lastError}`
              : state.qrExpired
                ? "The QR code expired before it was scanned. A new one is generated automatically — this should refresh within a few seconds. If it doesn't, the worker for this number may need a restart."
                : state.status === "CONNECTING"
                  ? "Connecting to WhatsApp Web… this can take up to a minute."
                  : `This number hasn't connected to the WhatsApp worker yet. Make sure the worker is running for session "${state.sessionId}".`}
          </p>
          {state.qrExpired && state.qrUpdatedAt && (
            <p className="text-xs text-muted-foreground">Last QR shown {formatDateTime(new Date(state.qrUpdatedAt))}</p>
          )}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            Check now
          </Button>
        </>
      )}
    </div>
  );
}

export function QrDialogButton({ initial, label = "Connect / QR" }: { initial: AccountState; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <QrCode className="size-3.5" />
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial.label} — WhatsApp connection</DialogTitle>
        </DialogHeader>
        {open && <QrPanel initial={initial} />}
      </DialogContent>
    </Dialog>
  );
}
