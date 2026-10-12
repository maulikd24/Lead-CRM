"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { addClientNoteAction } from "@/app/(dashboard)/clients/actions";
import {
  endMockCallAction,
  getCallSessionAction,
  getMyActiveCallIdAction,
  startClientCallAction,
  type CallSessionView,
} from "@/app/(dashboard)/click-to-call/actions";

// The widget checks on a live call this often. Quicker than the dashboards' live data, because "they picked up" should show at once.
const CALL_POLL_MS = 3000;

const CallContext = createContext<{ start: (clientId: string) => Promise<void>; busy: boolean }>({ start: async () => {}, busy: false });

/** Place a call to a client from anywhere inside the dashboard (the quick view's Call button). */
export function useClientCall() {
  return useContext(CallContext);
}

/**
 * Click-to-call and its live widget. Pressing Call rings the user's own phone through Exotel; when they answer, the client is
 * connected. The widget (bottom right) follows the call — ringing, connected with a running timer, ended with the outcome — and
 * then offers a quick note. It survives navigation and reloads (the active call is looked up on mount).
 */
export function ClickToCallProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let live = true;
    getMyActiveCallIdAction()
      .then((id) => live && id && setSessionId((current) => current ?? id))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const close = useCallback(() => setSessionId(null), []);

  const start = useCallback(async (clientId: string) => {
    setStarting(true);
    try {
      const result = await startClientCallAction(clientId);
      if (result.ok) {
        setSessionId(result.sessionId);
        toast.success(result.mock ? "Test call started — no phone will ring" : "Calling your phone — answer to connect the client");
      } else {
        toast.error(result.reason);
      }
    } catch {
      toast.error("Couldn't start the call. Try again.");
    } finally {
      setStarting(false);
    }
  }, []);

  return (
    <CallContext.Provider value={{ start, busy: starting || !!sessionId }}>
      {children}
      {sessionId && <CallWidget key={sessionId} sessionId={sessionId} onClose={close} />}
    </CallContext.Provider>
  );
}

const ENDED_TEXT: Record<string, string> = { COMPLETED: "Call ended", NO_ANSWER: "No answer", BUSY: "Line busy", FAILED: "Call failed" };

function CallWidget({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const router = useRouter();
  const [call, setCall] = useState<CallSessionView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ending, setEnding] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const refresh = useCallback(async () => {
    const view = await getCallSessionAction(sessionId).catch(() => null);
    if (view) setCall(view);
    else onClose();
  }, [sessionId, onClose]);

  const active = !call || call.status === "QUEUED" || call.status === "IN_PROGRESS";
  useEffect(() => {
    let live = true;
    getCallSessionAction(sessionId)
      .then((view) => {
        if (!live) return;
        if (view) setCall(view);
        else onClose();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId, onClose]);
  useVisiblePoll(() => (active ? refresh() : undefined), CALL_POLL_MS);

  // The running timer ticks once a second while connected.
  const connected = call?.status === "IN_PROGRESS";
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  async function endTestCall() {
    setEnding(true);
    try {
      const result = await endMockCallAction(sessionId);
      if (!result.ok) toast.error(result.reason);
      await refresh();
      router.refresh();
    } finally {
      setEnding(false);
    }
  }

  async function saveNote() {
    if (!call?.client || !note.trim()) return;
    setSavingNote(true);
    try {
      await addClientNoteAction(call.client.id, `Call note: ${note.trim()}`);
      toast.success("Note added to the client's activity");
      onClose();
      router.refresh();
    } catch {
      toast.error("Couldn't save the note");
    } finally {
      setSavingNote(false);
    }
  }

  const elapsed =
    call?.status === "IN_PROGRESS" && call.answeredAt
      ? Math.max(0, Math.floor((now - new Date(call.answeredAt).getTime()) / 1000))
      : (call?.durationSeconds ?? 0);
  const line = !call
    ? "Starting…"
    : call.status === "QUEUED"
      ? "Ringing your phone…"
      : call.status === "IN_PROGRESS"
        ? "Connected"
        : `${ENDED_TEXT[call.status] ?? "Call ended"}${call.durationSeconds ? ` · ${clock(call.durationSeconds)}` : ""}`;

  return (
    <section
      aria-label="Call in progress"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 text-card-foreground shadow-lg duration-200 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {active ? <Phone className="size-4" /> : <PhoneOff className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          {call?.client ? (
            <Link href={`/clients/${call.client.id}`} className="block truncate font-medium hover:underline">
              {call.client.name}
            </Link>
          ) : (
            <p className="font-medium">Call</p>
          )}
          <p className="text-sm text-muted-foreground">
            {line}
            {call?.mock && " (test)"}
          </p>
        </div>
        {connected ? (
          <span className="font-heading text-2xl font-semibold tabular-nums" aria-label={`Call time ${clock(elapsed)}`}>
            {clock(elapsed)}
          </span>
        ) : (
          !active && (
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          )
        )}
      </div>

      {active && call?.mock && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="destructive" onClick={endTestCall} disabled={ending}>
            <PhoneOff className="size-3.5" /> {ending ? "Ending…" : "End test call"}
          </Button>
        </div>
      )}
      {active && call && !call.mock && <p className="mt-2 text-xs text-muted-foreground">Hang up on your phone to end the call.</p>}

      {!active && call?.client && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was discussed? (optional)" aria-label="Call note" />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Done
            </Button>
            <Button type="submit" size="sm" disabled={savingNote || !note.trim()}>
              {savingNote ? "Saving…" : "Save note"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function clock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
