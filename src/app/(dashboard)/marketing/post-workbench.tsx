"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, FilePlus2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { SOCIAL_CHANNELS, appendRequiredDisclosures, checkPost, type SocialChannel } from "@/lib/marketing/social/compliance";
import type { PostView } from "@/lib/marketing/social/queries";
import { STATUS_LABEL } from "@/lib/marketing/social/workflow";
import { formatInZone } from "@/lib/marketing/zoned-time";
import { cn } from "@/lib/utils";

import { aiDraftAction, createDraftAction, discardDraftAction, saveDraftAction, transitionAction, type ActionResult } from "./social-actions";

const field = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The editor and the workflow buttons for one post (or a new one). Compliance is checked live with the same function the
 * server uses at every gate, but the server decides: nothing here is trusted. Nothing on this page publishes anything.
 */
export function PostWorkbench({ post, timezone, backHref, hrefFor, defaultChannel }: { post: PostView | null; timezone: string; backHref: string; hrefFor: (id: string) => string; defaultChannel: SocialChannel }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [channel, setChannel] = useState<string>(post?.channel ?? defaultChannel);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const dirty = !post || channel !== post.channel || title !== (post.title ?? "") || body !== post.body;
  const result = useMemo(() => checkPost({ channel, body }), [channel, body]);
  const limit = channel in SOCIAL_CHANNELS ? SOCIAL_CHANNELS[channel as SocialChannel].maxLength : 0;
  const status = post?.status;

  function run(fn: () => Promise<ActionResult>, okText: string, after?: (r: ActionResult) => void) {
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          setMessage({ tone: "ok", text: okText });
          after?.(r);
          router.refresh();
        } else {
          setMessage({ tone: "error", text: r.issues?.length ? `${r.error} ${r.issues.map((i) => i.message).join(" ")}` : r.error });
        }
      } catch {
        setMessage({ tone: "error", text: "Something went wrong. Please try again." });
      }
    });
  }

  const save = () =>
    run(
      () => (post ? saveDraftAction(post.id, { channel, title, body }) : createDraftAction({ channel, title, body })),
      post ? (status && status !== "DRAFT" ? "Saved. The post is back in Draft and needs approval again." : "Saved.") : "Draft created.",
      (r) => {
        if (!post && r.ok && r.id) router.push(hrefFor(r.id));
      },
    );
  const act = (action: string, okText: string, extra: Parameters<typeof transitionAction>[2] = {}) => run(() => transitionAction(post?.id, action, extra), okText);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" render={<Link href={backHref} scroll={false} />}>← Back to posts</Button>
        {post && <Badge variant={post.status === "APPROVED" ? "success" : post.status === "NEEDS_REVIEW" ? "warning" : "outline"}>{STATUS_LABEL[post.status]}</Badge>}
      </div>

      {post?.reviewNote && post.status === "DRAFT" && (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /><span><strong className="font-medium">Changes requested:</strong> {post.reviewNote}</span></p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading">{post ? "Edit post" : "New post draft"}</CardTitle>
          <CardDescription>{post && post.status !== "DRAFT" ? "Saving a change sends this post back to Draft and withdraws its approval, because the new text was never approved." : "Write for a reader who is new to investing. Educate; do not promise, recommend or pressure."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Channel
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
                {Object.entries(SOCIAL_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Title (internal, optional)
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={field} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Post text
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} className="min-h-40 text-sm" aria-describedby="post-count" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id="post-count" className={cn("text-xs tabular-nums", limit && body.length > limit ? "text-destructive" : "text-muted-foreground")}>{`${body.length.toLocaleString("en-IN")} / ${limit.toLocaleString("en-IN")} characters`}</p>
            <Button size="sm" variant="outline" type="button" onClick={() => setBody((b) => appendRequiredDisclosures(b))}><FilePlus2 aria-hidden />Insert required disclosures</Button>
          </div>

          <div aria-live="polite" className="rounded-lg border bg-muted/30 p-3">
            {body.trim() === "" ? (
              <p className="text-sm text-muted-foreground">The compliance check runs as you type.</p>
            ) : result.ok ? (
              <p className="flex items-start gap-2 text-sm"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /><span>Passes the automatic checks. A person still has to approve it.</span></p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {result.issues.map((i) => <li key={i.code} className="flex items-start gap-2 text-sm"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /><span>{i.message}</span></li>)}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={pending || !dirty || !body.trim()}>{post ? "Save changes" : "Create draft"}</Button>
            {post && status === "DRAFT" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => discardDraftAction(post.id), "Draft discarded.", () => router.push(backHref))}>Discard draft</Button>
            )}
            {dirty && post && <span className="text-xs text-muted-foreground">Save your changes before moving the post on.</span>}
          </div>
        </CardContent>
      </Card>

      {post && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-sm">Next step</CardTitle>
            <CardDescription>Nothing here publishes a post. The last step, Scheduled, only records when it is meant to go out.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {status === "DRAFT" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={pending || dirty || !result.ok} onClick={() => act("submit", "Sent for review.")}>Submit for review</Button>
                {!result.ok && !dirty && <span className="text-xs text-muted-foreground">Fix the items above first.</span>}
              </div>
            )}
            {status === "NEEDS_REVIEW" && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" />
                  <span>I have read this post and its disclosures, and approve it for publication by the team.</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={pending || dirty || !confirmed || !result.ok} onClick={() => act("approve", "Approved.", { confirmed })}>Approve</Button>
                </div>
                <div className="flex flex-col gap-2 border-t pt-3">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Or send it back with a note
                    <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What needs to change?" className={field} />
                  </label>
                  <div><Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => act("request_changes", "Sent back to Draft.", { note })}>Request changes</Button></div>
                </div>
              </>
            )}
            {status === "APPROVED" && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {`Intended to go out (${timezone})`}
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={cn(field, "w-56")} />
                </label>
                <Button size="sm" disabled={pending || dirty || !when} onClick={() => act("schedule", "Scheduled. This records the intent only; nothing is published.", { scheduledLocal: when })}>Schedule</Button>
              </div>
            )}
            {status === "SCHEDULED" && post.scheduledFor && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">{`Intended for ${formatInZone(new Date(post.scheduledFor), timezone)}. Nothing is published automatically.`}</p>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act("unschedule", "Back to Approved.")}>Unschedule</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {message && <p className={message.tone === "error" ? "text-destructive" : "text-success"}>{message.text}</p>}
      </div>
    </div>
  );
}

/** Asks the AI for a draft from a short brief. The draft is checked and, if it passes, saved as an ordinary Draft for a person to edit. */
export function AiDraftForm({ defaultChannel, hrefFor }: { defaultChannel: SocialChannel; hrefFor: (id: string) => string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [brief, setBrief] = useState("");
  const [channel, setChannel] = useState<string>(defaultChannel);
  const [error, setError] = useState<string | null>(null);

  function go() {
    start(async () => {
      setError(null);
      try {
        const r = await aiDraftAction({ brief, channel });
        if (r.ok && r.id) router.push(hrefFor(r.id));
        else if (!r.ok) setError(r.error);
      } catch {
        setError("Something went wrong. Nothing was drafted.");
      }
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-heading text-sm">Draft with AI</CardTitle>
        <CardDescription>Describe the topic in a sentence. Only that text and the channel are sent, never customer data. The draft is checked and saved for you to edit; it is never posted.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Topic
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={500} placeholder="e.g. What documents you need to open a demat account" className="min-h-16 text-sm" />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
              {Object.entries(SOCIAL_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <Button size="sm" onClick={go} disabled={pending || !brief.trim()}>{pending ? "Drafting…" : "Draft"}</Button>
        </div>
        <div role="status" aria-live="polite" className="min-h-4 text-xs">{error && <p className="text-destructive">{error}</p>}</div>
      </CardContent>
    </Card>
  );
}
