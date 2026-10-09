"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, ExternalLink, Send, Smartphone, UserCircle2 } from "lucide-react";
import { toast } from "sonner";

import { cn, initials } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ThreadData, ThreadMessage } from "@/lib/whatsapp/inbox-queries";
import { retryMessageAction, sendReplyAction } from "./actions";
import { AccountStatusDot } from "./account-status-dot";
import { SuggestedReplyPanel } from "./suggested-reply-panel";
import { enterMaySend } from "./composer-guard";
import { formatChatTime, formatDayLabel } from "./format";
import { istDateKey } from "@/lib/utils/ist-date";

function StatusMark({ message, onRetry }: { message: ThreadMessage; onRetry: (id: string) => void }) {
  if (message.direction !== "OUTBOUND") return null;
  switch (message.status) {
    case "QUEUED":
      return (
        <span className="flex items-center gap-1 text-[10px] opacity-80">
          <Clock className="size-3" /> Sending…
        </span>
      );
    case "SENT":
      return <Check className="size-3.5 opacity-80" aria-label="Sent" />;
    case "DELIVERED":
      return <CheckCheck className="size-3.5 opacity-80" aria-label="Delivered" />;
    case "READ":
      return <CheckCheck className="size-3.5 text-sky-300" aria-label="Read" />;
    case "FAILED":
      return (
        <button type="button" onClick={() => onRetry(message.id)} className="flex items-center gap-1 text-[10px] font-semibold underline">
          <AlertCircle className="size-3" /> Failed · Retry
        </button>
      );
    default:
      return null;
  }
}

function Bubble({ message, showAccount, onRetry }: { message: ThreadMessage; showAccount: boolean; onRetry: (id: string) => void }) {
  const outbound = message.direction === "OUTBOUND";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[78%] rounded-lg px-3 py-2 text-sm",
          outbound ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted text-foreground",
          message.status === "FAILED" && "ring-1 ring-destructive",
        )}
      >
        <p className="break-words whitespace-pre-wrap">{message.body}</p>
        {message.error && message.status === "FAILED" && <p className="mt-1 text-[10px] opacity-80">{message.error}</p>}
        <div className={cn("mt-1 flex items-center justify-end gap-2 text-[10px]", outbound ? "opacity-80" : "text-muted-foreground")}>
          {showAccount && message.accountLabel && <span>via {message.accountLabel}</span>}
          {message.origin === "phone" && (
            <span className="flex items-center gap-0.5">
              <Smartphone className="size-3" /> from phone
            </span>
          )}
          {message.origin === "crm" && message.senderName && <span>{message.senderName}</span>}
          <span>{formatChatTime(message.at)}</span>
          <StatusMark message={message} onRetry={onRetry} />
        </div>
      </div>
    </div>
  );
}

export function ThreadPane({
  thread,
  loading,
  onBack,
  onSent,
}: {
  thread: ThreadData | null;
  loading: boolean;
  onBack: () => void;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestion, setSuggestion] = useState<{ clientId: string; id: string } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const usedAt = useRef<number | null>(null);
  const restoreFocus = useCallback(() => composerRef.current?.focus(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastClientId = useRef<string | null>(null);

  const messageCount = thread?.messages.length ?? 0;
  const clientId = thread?.client.id ?? null;
  const suggestionId = suggestion && suggestion.clientId === clientId ? suggestion.id : null; // a suggestion belongs to one conversation

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastClientId.current !== clientId) {
      lastClientId.current = clientId;
      stickToBottom.current = true;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [clientId, messageCount]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function handleSend() {
    if (!thread || sending) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendReplyAction(thread.client.id, body, suggestionId ?? undefined);
      setDraft("");
      setSuggestion(null);
      stickToBottom.current = true;
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleRetry(messageId: string) {
    try {
      await retryMessageAction(messageId);
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry message");
    }
  }

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        {loading ? "Loading conversation…" : "Select a conversation to view messages."}
      </div>
    );
  }

  const accountLabels = new Set(thread.messages.map((m) => m.accountLabel).filter(Boolean));
  const multiAccount = accountLabels.size > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </button>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {initials(thread.client.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{thread.client.name}</p>
            <span className="font-mono text-[11px] text-muted-foreground">{thread.client.clientCode}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {thread.client.mobile && <span>{thread.client.mobile}</span>}
            <span className="flex items-center gap-1">
              <UserCircle2 className="size-3" />
              {thread.client.assigneeName ?? "Unassigned"}
            </span>
            {thread.account && (
              <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                <AccountStatusDot online={thread.account.online} className="size-1.5" />
                Received on {thread.account.label}
                {thread.account.phoneNumber ? ` · +${thread.account.phoneNumber}` : ""}
              </Badge>
            )}
          </div>
        </div>
        {thread.profileLinkable && (
          <Button size="sm" variant="outline" render={<Link href={`/clients/${thread.client.id}`} />}>
            <ExternalLink className="size-3.5" />
            Profile
          </Button>
        )}
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-background/60 p-4">
        {thread.messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">No messages yet.</p>}
        {thread.messages.map((message, i) => {
          const prev = thread.messages[i - 1];
          const newDay = !prev || istDateKey(new Date(prev.at)) !== istDateKey(new Date(message.at));
          return (
            <div key={message.id} className="flex flex-col gap-2">
              {newDay && (
                <div className="my-1 flex justify-center">
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {formatDayLabel(message.at)}
                  </span>
                </div>
              )}
              <Bubble message={message} showAccount={multiAccount} onRetry={handleRetry} />
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-3">
        {thread.canReply && thread.serviceWindow.required && (
          <p role="alert" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground">
            The 24-hour WhatsApp window has closed for this customer. Free-text replies are not allowed; send an approved template instead.
          </p>
        )}
        {thread.canReply && !thread.serviceWindow.required && (
          <SuggestedReplyPanel
            key={thread.client.id}
            clientId={thread.client.id}
            lastInboundId={thread.lastInbound?.id ?? null}
            unanswered={thread.unanswered}
            usedId={suggestionId}
            onUse={(id, body) => {
              setDraft(body);
              setSuggestion({ clientId: thread.client.id, id });
              usedAt.current = Date.now();
              composerRef.current?.focus();
            }}
            onRestoreFocus={restoreFocus}
            onDismissed={(id) => {
              if (id === suggestionId) setSuggestion(null);
            }}
          />
        )}
        {!thread.canReply ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{thread.replyBlockedReason}</p>
        ) : thread.serviceWindow.required ? null : (
          <div className="flex items-end gap-2">
            <Textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  // Held Enter, IME confirmation, Shift+Enter, or Enter right after "Use" must not send an unreviewed AI draft.
                  if (enterMaySend({ repeat: e.repeat, isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey, msSinceUse: usedAt.current === null ? null : Date.now() - usedAt.current })) void handleSend();
                }
              }}
              rows={2}
              maxLength={4096}
              placeholder={`Reply from ${thread.account?.label ?? "WhatsApp"}… (Enter to send, Shift+Enter for a new line)`}
              className="min-h-0 flex-1 resize-none text-sm"
            />
            <Button onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
              <Send className="size-3.5" />
              Send
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
