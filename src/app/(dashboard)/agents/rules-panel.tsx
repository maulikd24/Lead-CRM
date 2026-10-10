"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { motion } from "@/components/workspace";
import { setAgentEnabledAction } from "./actions";

export type AgentRow = { key: string; label: string; blurb: string; envFlag: string; envOn: boolean; rowOn: boolean };

function Switch({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant={on ? "default" : "outline"}>{on ? "On" : "Off"}</Badge>
    </div>
  );
}

function AgentCard({ agent, canSwitch, index }: { agent: AgentRow; canSwitch: boolean; index: number }) {
  const [rowOn, setRowOn] = useState(agent.rowOn);
  const [pending, start] = useTransition();
  const running = agent.envOn && rowOn;
  const toggle = () =>
    start(async () => {
      const next = !rowOn;
      try {
        const res = await setAgentEnabledAction(agent.key, next);
        if (res.ok) {
          setRowOn(next);
          toast.success(next ? `${agent.label} switched on` : `${agent.label} switched off`);
        } else toast.error("Could not change the switch");
      } catch {
        toast.error("Could not change the switch");
      }
    });
  return (
    <Card size="sm" className={motion.enter} style={{ ["--i" as string]: index }}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          {agent.label}
          <Badge variant={running ? "default" : "outline"}>{running ? "Running" : "Stopped"}</Badge>
        </CardTitle>
        <CardDescription>{agent.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Switch on={agent.envOn} label={`Environment flag (${agent.envFlag}=1)`} />
        <Switch on={rowOn} label="Kill switch" />
        {!agent.envOn && <p className="text-xs text-muted-foreground">The environment flag is off, so this agent stays stopped even with the kill switch on. It is set by whoever runs the server.</p>}
        {canSwitch ? (
          <Button size="sm" variant={rowOn ? "outline" : "default"} disabled={pending} onClick={toggle} className="w-fit">
            {pending ? "Working…" : rowOn ? "Switch off now" : "Switch on"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Only an Admin can change the kill switch.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Rules in plain words, then one card per agent with its two switches. */
export function RulesPanel({ agents, rules, canSwitch }: { agents: AgentRow[]; rules: string[]; canSwitch: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Rules every agent follows</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            {rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {agents.map((a, i) => (
          <AgentCard key={a.key} agent={a} canSwitch={canSwitch} index={i} />
        ))}
      </div>
    </div>
  );
}
