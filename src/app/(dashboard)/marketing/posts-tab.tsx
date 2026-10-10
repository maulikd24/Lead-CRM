import Link from "next/link";
import { CalendarDays, LayoutGrid, Plus, ShieldCheck } from "lucide-react";

import { agentEnabled } from "@/lib/agents/enabled";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AI_DRAFTER_KEY } from "@/lib/marketing/social/ai-draft";
import { socialTimezone } from "@/lib/marketing/social/config";
import { loadPost, loadPosts } from "@/lib/marketing/social/queries";
import { workspaceHref } from "@/lib/marketing/workspace-params";
import { todayInTimeZone } from "@/lib/marketing/dates";

import { AiSwitch } from "./ai-switch";
import { PostBoard } from "./post-board";
import { PostCalendar } from "./post-calendar";
import { PostHistory, StatusSteps } from "./post-history";
import { AiDraftForm, PostActionsCard, PostEditor, WorkbenchProvider } from "./post-workbench";
import { Rail, type RailFact } from "./rail";
import { TabLayout } from "./tab-layout";

export async function PostsTab({ view, month, postId, isAdmin, viewerId }: { view: "board" | "calendar"; month: string; postId: string | undefined; isAdmin: boolean; viewerId: string }) {
  const timezone = socialTimezone();
  const today = todayInTimeZone(new Date(), timezone);
  const [posts, aiOn, detail] = await Promise.all([
    loadPosts(),
    agentEnabled(AI_DRAFTER_KEY, process.env, (key) => prisma.agentSetting.findUnique({ where: { agentKey: key }, select: { enabled: true } })),
    postId && postId !== "new" ? loadPost(postId) : Promise.resolve(null),
  ]);
  const hrefFor = (id: string) => workspaceHref({ tab: "posts", view, month: view === "calendar" ? month : undefined, post: id });
  const listHref = workspaceHref({ tab: "posts", view, month: view === "calendar" ? month : undefined });
  const count = (s: string) => posts.filter((p) => p.status === s).length;
  const editing = postId === "new" || detail !== null;

  const facts: RailFact[] = detail
    ? []
    : [
        { key: "review", label: "Waiting for review", value: { n: count("NEEDS_REVIEW"), kind: "count" }, tone: count("NEEDS_REVIEW") > 0 ? "warning" : undefined, hint: count("NEEDS_REVIEW") > 0 ? "A manager needs to read these" : "Nothing waiting" },
        { key: "approved", label: "Approved", value: { n: count("APPROVED"), kind: "count" }, hint: "Ready to schedule" },
        { key: "scheduled", label: "Scheduled", value: { n: count("SCHEDULED"), kind: "count" }, hint: "Intent only; nothing is posted" },
      ];

  const guard = (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-sm"><ShieldCheck aria-hidden className="size-4 text-primary" />How posts are kept safe</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>No promised or guaranteed returns, advice, performance figures, urgency or &ldquo;best&rdquo; claims.</li>
          <li>The market-risk statement and a SEBI registration line are required.</li>
          <li>A person approves every post, and never the one who wrote it. Nothing is published automatically.</li>
        </ul>
      </CardContent>
    </Card>
  );

  const actions = (
    <>
      <Button size="sm" render={<Link href={workspaceHref({ tab: "posts", view, month: view === "calendar" ? month : undefined, post: "new" })} scroll={false} />}><Plus aria-hidden />New draft</Button>
      <Button size="sm" variant={view === "board" ? "secondary" : "outline"} aria-current={view === "board" ? "true" : undefined} render={<Link href={workspaceHref({ tab: "posts", view: "board" })} scroll={false} />}><LayoutGrid aria-hidden />Board</Button>
      <Button size="sm" variant={view === "calendar" ? "secondary" : "outline"} aria-current={view === "calendar" ? "true" : undefined} render={<Link href={workspaceHref({ tab: "posts", view: "calendar", month })} scroll={false} />}><CalendarDays aria-hidden />Calendar</Button>
    </>
  );

  const rail = detail ? (
    <Rail facts={[{ key: "by", label: "Drafted by", value: detail.post.createdByName ?? "Unknown", hint: detail.post.source === "AI" ? "AI draft, edited by people" : undefined }, ...(detail.post.approvedByName ? [{ key: "appr", label: "Approved by", value: detail.post.approvedByName, tone: "success" as const }] : [])]}>
      <Card size="sm"><CardContent><StatusSteps status={detail.post.status} /></CardContent></Card>
      <PostActionsCard />
      <Card size="sm"><CardHeader><CardTitle className="font-heading text-sm">History</CardTitle></CardHeader><CardContent><PostHistory events={detail.events} timezone={timezone} /></CardContent></Card>
      {guard}
    </Rail>
  ) : (
    <Rail facts={facts} actions={actions}>
      {aiOn ? <AiDraftForm defaultChannel="linkedin" /> : (
        <Card size="sm"><CardContent className="flex flex-col gap-2 text-xs text-muted-foreground"><p>AI drafting is switched off.</p>{isAdmin && <AiSwitch on={false} />}</CardContent></Card>
      )}
      {aiOn && isAdmin && <AiSwitch on />}
      {guard}
    </Rail>
  );

  const main = editing ? (
    postId !== "new" && !detail ? (
      <Card><CardContent className="text-sm">That post no longer exists. <Link className="underline underline-offset-4" href={listHref} scroll={false}>Back to posts</Link></CardContent></Card>
    ) : (
      <PostEditor />
    )
  ) : view === "calendar" ? (
    <PostCalendar posts={posts} month={month} today={today} timezone={timezone} hrefFor={hrefFor} />
  ) : posts.length === 0 ? (
    <Card><CardContent className="flex flex-col items-start gap-2 text-sm"><p className="font-medium">No post drafts yet.</p><p className="text-muted-foreground">Write one yourself, or ask the AI for a first draft. Every post is checked and a person approves it. Nothing is ever published for you.</p></CardContent></Card>
  ) : (
    <PostBoard posts={posts} hrefFor={hrefFor} timezone={timezone} />
  );

  const layout = <TabLayout tab="posts" rail={rail} main={main} />;
  if (!editing || (postId !== "new" && !detail)) return layout;
  return (
    <WorkbenchProvider key={detail?.post.id ?? "new"} post={detail?.post ?? null} viewerId={viewerId} timezone={timezone} view={view} month={month} defaultChannel="linkedin">
      {layout}
    </WorkbenchProvider>
  );
}
