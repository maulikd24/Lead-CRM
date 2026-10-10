"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PILOT_BLOCK_TEXT, type PilotBlock } from "@/lib/agents/pilot";
import type { Change } from "@/lib/agents/pilot-service";
import { addPilotUserAction, recordSignoffAction, removeAiKeyAction, removePilotUserAction, revokeSignoffAction, saveAiKeyAction } from "./actions";

export type PilotViewProps = {
  statementVersion: string;
  statement: string[];
  /** WA_ASSIST_ENABLED=1 on this deployment. */
  envOn: boolean;
  /** Flag AND kill switch. */
  agentOn: boolean;
  missing: Exclude<PilotBlock, "not_in_pilot">[];
  aiKey: { last4: string; savedAt: string; savedByName: string | null } | null;
  signoff: { byName: string | null; at: string } | null;
  users: { id: string; name: string; role: string; addedAt: string }[];
  candidates: { id: string; name: string; role: string }[];
};

const field = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

function useRun() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Change>, ok: string) =>
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error);
        else toast.success(r.changed ? ok : "Nothing to change");
      } catch {
        toast.error("Could not save. Try again.");
      }
    });
  return { pending, run };
}

function KeyCard({ aiKey }: Pick<PilotViewProps, "aiKey">) {
  const { pending, run } = useRun();
  const [value, setValue] = useState("");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">1. AI provider key {aiKey ? <Badge variant="success">Saved</Badge> : <Badge variant="outline">Not saved</Badge>}</CardTitle>
        <CardDescription>The assistant uses only the key saved here, stored encrypted. It is never shown again after saving.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {aiKey && (
          <p className="text-sm">
            Key ending {aiKey.last4}, saved by {aiKey.savedByName ?? "an Admin"} on {aiKey.savedAt}.
          </p>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { const r = await saveAiKeyAction(value); if (r.ok) setValue(""); return r; }, aiKey ? "Key replaced" : "Key saved");
          }}
        >
          <label className="sr-only" htmlFor="ai-key">AI provider key</label>
          <input id="ai-key" name="aiKey" type="password" autoComplete="off" spellCheck={false} placeholder={aiKey ? "Paste a new key to replace it" : "Paste the key"} value={value} onChange={(e) => setValue(e.target.value)} className={field} />
          <Button type="submit" size="sm" disabled={pending || value.trim().length === 0}>{aiKey ? "Replace key" : "Save key"}</Button>
        </form>
        {aiKey && (
          <Button size="sm" variant="outline" className="w-fit" disabled={pending} onClick={() => run(() => removeAiKeyAction(), "Key removed")}>Remove key</Button>
        )}
      </CardContent>
    </Card>
  );
}

function SignoffCard({ statement, statementVersion, signoff }: Pick<PilotViewProps, "statement" | "statementVersion" | "signoff">) {
  const { pending, run } = useRun();
  const [ticked, setTicked] = useState(false);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">2. Compliance sign-off {signoff ? <Badge variant="success">Recorded</Badge> : <Badge variant="outline">Not recorded</Badge>}</CardTitle>
        <CardDescription>Compliance reads this wording. The Admin records that they agreed. The wording version is {statementVersion}; a change to the wording needs a new sign-off.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {statement.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {signoff ? (
          <>
            <p className="text-sm">Recorded by {signoff.byName ?? "an Admin"} on {signoff.at}.</p>
            <Button size="sm" variant="outline" className="w-fit" disabled={pending} onClick={() => run(() => revokeSignoffAction(), "Sign-off withdrawn")}>Withdraw sign-off</Button>
          </>
        ) : (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 size-4" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
              <span>Compliance has reviewed the wording above and agrees to a limited pilot. I am recording this on the company&apos;s behalf.</span>
            </label>
            <Button size="sm" className="w-fit" disabled={pending || !ticked} onClick={() => run(() => recordSignoffAction({ confirmed: ticked, statementVersion }), "Sign-off recorded")}>Record sign-off</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ListCard({ users, candidates }: Pick<PilotViewProps, "users" | "candidates">) {
  const { pending, run } = useRun();
  const [pick, setPick] = useState("");
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">3. Who is in the pilot <Badge variant="outline">{users.length} {users.length === 1 ? "person" : "people"}</Badge></CardTitle>
        <CardDescription>Only these people see the assistant in the Inbox. Each change is recorded with who made it and when.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is on the list, so nobody can use the assistant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {u.name} <span className="text-muted-foreground">({u.role === "RM" ? "Relationship manager" : "Admin"}), added {u.addedAt}</span>
                </span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => removePilotUserAction(u.id), `${u.name} removed`)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => { const r = await addPilotUserAction(pick); if (r.ok) setPick(""); return r; }, "Added to the pilot");
          }}
        >
          <label className="sr-only" htmlFor="pilot-add">Add a person</label>
          <select id="pilot-add" value={pick} onChange={(e) => setPick(e.target.value)} className={field}>
            <option value="">Choose a person to add</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.role === "RM" ? "Relationship manager" : "Admin"})</option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={pending || !pick}>Add</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PilotView(p: PilotViewProps) {
  const on = p.missing.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            {on ? "Pilot is on" : "Pilot is off"}
            <Badge variant={on ? "success" : "outline"}>{on ? `${p.users.length} ${p.users.length === 1 ? "person" : "people"} can use it` : "Nobody can use it"}</Badge>
          </CardTitle>
          <CardDescription>The reply assistant only drafts. The relationship manager reads, edits and presses Send. It stays off until all three steps below are done and the two switches are on.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {on ? <p>All prerequisites are met.</p> : (
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {p.missing.map((m) => (
                <li key={m}>{PILOT_BLOCK_TEXT[m]}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Switches: environment flag WA_ASSIST_ENABLED is {p.envOn ? "on" : "off"} (set by whoever runs the server), and the Reply assistant kill switch on the Agents page is {p.agentOn ? "on" : p.envOn ? "off" : "irrelevant while the flag is off"}.
          </p>
        </CardContent>
      </Card>
      <KeyCard aiKey={p.aiKey} />
      <SignoffCard statement={p.statement} statementVersion={p.statementVersion} signoff={p.signoff} />
      <ListCard users={p.users} candidates={p.candidates} />
    </div>
  );
}
