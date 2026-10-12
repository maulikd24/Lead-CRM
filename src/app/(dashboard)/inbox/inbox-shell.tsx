"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { ConversationFilters, ConversationSummary, ThreadData } from "@/lib/whatsapp/inbox-queries";
import { getThreadAction, listConversationsAction } from "./actions";
import { ConversationList, type AccountOption, type RmOption } from "./conversation-list";
import { ThreadPane } from "./thread-pane";
import { useVisiblePoll } from "@/hooks/use-visible-poll";

const LIST_POLL_MS = 6000;
const THREAD_POLL_MS = 3000;
const FILTER_DEBOUNCE_MS = 300;

export function InboxShell({
  accounts,
  rms,
  showTeamFilters,
  initialSelectedId,
}: {
  accounts: AccountOption[];
  rms: RmOption[];
  showTeamFilters: boolean;
  initialSelectedId: string | null;
}) {
  const [filters, setFilters] = useState<ConversationFilters>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadLoading, setThreadLoading] = useState(initialSelectedId !== null);

  const filtersRef = useRef(filters);
  const selectedRef = useRef(selectedId);
  const listRequest = useRef(0);
  const threadRequest = useRef(0);
  const firstFilterRun = useRef(true);

  useEffect(() => {
    filtersRef.current = filters;
    selectedRef.current = selectedId;
  });

  const loadConversations = useCallback(async () => {
    const requestId = ++listRequest.current;
    try {
      const result = await listConversationsAction(filtersRef.current);
      if (requestId === listRequest.current) setConversations(result);
    } catch {
      // A failed poll just keeps the last good list; the next tick retries.
    } finally {
      if (requestId === listRequest.current) setListLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (clientId: string) => {
    const requestId = ++threadRequest.current;
    try {
      const result = await getThreadAction(clientId);
      if (requestId !== threadRequest.current || selectedRef.current !== clientId) return;
      if (result === null) {
        // Reassigned away / archived / merged while open: the scope check no longer passes.
        setSelectedId(null);
        setThread(null);
        window.history.replaceState(null, "", "/inbox");
        toast.info("That conversation is no longer available to you.");
        void loadConversations();
        return;
      }
      setThread(result);
    } catch {
      // Keep the last good thread on a failed poll.
    } finally {
      if (requestId === threadRequest.current) setThreadLoading(false);
    }
  }, [loadConversations]);

  // Debounced refetch on filter changes; the very first run (mount) is immediate.
  useEffect(() => {
    if (firstFilterRun.current) {
      firstFilterRun.current = false;
      void loadConversations();
      return;
    }
    const timer = setTimeout(() => void loadConversations(), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters, loadConversations]);

  useEffect(() => {
    // Opening a thread marks it read server-side, so refresh the list afterwards to clear the unread pill now.
    if (!initialSelectedId) return;
    const timer = setTimeout(() => void loadThread(initialSelectedId).then(() => loadConversations()), 0);
    return () => clearTimeout(timer);
  }, [initialSelectedId, loadThread, loadConversations]);

  useVisiblePoll(() => loadConversations(), LIST_POLL_MS);
  useVisiblePoll(() => {
    const id = selectedRef.current;
    if (id) return loadThread(id);
  }, THREAD_POLL_MS);

  function handleSelect(clientId: string) {
    setSelectedId(clientId);
    selectedRef.current = clientId;
    setThread(null);
    setThreadLoading(true);
    window.history.replaceState(null, "", `/inbox?client=${clientId}`);
    void loadThread(clientId).then(() => loadConversations());
  }

  function handleBack() {
    setSelectedId(null);
    selectedRef.current = null;
    setThread(null);
    window.history.replaceState(null, "", "/inbox");
  }

  function handleSent() {
    if (selectedId) void loadThread(selectedId);
    void loadConversations();
  }

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[400px] overflow-hidden md:h-[calc(100dvh-12rem)] rounded-lg border border-border bg-card">
      <div className={cn("w-full flex-col border-r border-border md:flex md:w-[360px] md:shrink-0", selectedId ? "hidden" : "flex")}>
        <ConversationList
          conversations={conversations}
          loading={listLoading}
          selectedId={selectedId}
          onSelect={handleSelect}
          filters={filters}
          onFiltersChange={setFilters}
          accounts={accounts}
          rms={rms}
          showTeamFilters={showTeamFilters}
        />
      </div>
      <div className={cn("min-w-0 flex-1 flex-col md:flex", selectedId ? "flex" : "hidden")}>
        <ThreadPane thread={thread} loading={threadLoading} onBack={handleBack} onSent={handleSent} />
      </div>
    </div>
  );
}
