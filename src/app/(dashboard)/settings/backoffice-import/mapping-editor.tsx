"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PhoneSheet, StickyActionBar } from "@/components/workspace";
import { saveMappingAction } from "./actions";

type Section = "clients" | "holdings" | "transactions";
type Mapping = {
  version: 1;
  dateFormat: string;
  updatePolicy: string;
  filePrefixes: Record<Section, string>;
  clients: Record<string, string | undefined>;
  holdings: Record<string, string | undefined>;
  transactions: Record<string, string | undefined>;
  valueMaps: { category: Record<string, string>; type: Record<string, string> };
};

const SELECT = "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";
const SECTION_LABEL: Record<Section, string> = { clients: "Client master file", holdings: "Holdings file", transactions: "Transactions file" };

const toLines = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k} = ${v}`).join("\n");
function fromLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim()) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Which CSV header carries each field. Blank = the file has no such column. Saved in Settings, not in code. */
export function MappingEditor({ initial, fields }: { initial: Mapping; fields: Record<Section, string[]> }) {
  const [m, setM] = useState<Mapping>(initial);
  const [category, setCategory] = useState(toLines(initial.valueMaps.category));
  const [type, setType] = useState(toLines(initial.valueMaps.type));
  const [pending, startTransition] = useTransition();

  const setCol = (section: Section, field: string, value: string) => setM((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value.trim() === "" ? undefined : value } }));

  function save() {
    const body = { ...m, valueMaps: { category: fromLines(category), type: fromLines(type) } };
    startTransition(async () => {
      const r = await saveMappingAction(JSON.stringify(body));
      if (r.ok) toast.success("Column mapping saved");
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-date">Date notation in the files</Label>
          <select id="bo-date" className={SELECT} value={m.dateFormat} onChange={(e) => setM({ ...m, dateFormat: e.target.value })}>
            <option value="iso">2026-10-31 (year-month-day)</option>
            <option value="dmy">31/10/2026 (day first)</option>
            <option value="mdy">10/31/2026 (month first)</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-policy">When a client already has a value</Label>
          <select id="bo-policy" className={SELECT} value={m.updatePolicy} onChange={(e) => setM({ ...m, updatePolicy: e.target.value })}>
            <option value="fill_blank">Keep it; only fill blanks</option>
            <option value="overwrite">Replace name, city, state and type</option>
          </select>
        </div>
      </div>

      {(Object.keys(fields) as Section[]).map((section) => (
        <PhoneSheet key={section} name={`map-${section}`} title={SECTION_LABEL[section]} summary={`${fields[section].filter((f) => m[section][f]).length} of ${fields[section].length} columns mapped · file starts with "${m.filePrefixes[section]}"`}>
        <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
          <legend className="px-1 font-heading text-sm font-semibold">{SECTION_LABEL[section]}</legend>
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor={`bo-prefix-${section}`}>File name starts with</Label>
            <Input id={`bo-prefix-${section}`} value={m.filePrefixes[section]} onChange={(e) => setM({ ...m, filePrefixes: { ...m.filePrefixes, [section]: e.target.value } })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields[section].map((field) => (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={`bo-${section}-${field}`} className="font-mono text-xs">{field}</Label>
                <Input id={`bo-${section}-${field}`} value={m[section][field] ?? ""} placeholder="no such column" onChange={(e) => setCol(section, field, e.target.value)} />
              </div>
            ))}
          </div>
        </fieldset>
        </PhoneSheet>
      ))}

      <PhoneSheet name="map-labels" title="Value labels" summary={`${Object.keys(fromLines(category)).length} asset class and ${Object.keys(fromLines(type)).length} transaction type labels`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-vm-category">Asset class labels (one per line: label = EQUITY)</Label>
          <Textarea id="bo-vm-category" rows={4} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="mutual fund = MUTUAL_FUND" />
          <p className="text-xs text-muted-foreground">Allowed: EQUITY, MUTUAL_FUND, PMS, INSURANCE, BOND, FIXED_DEPOSIT, NPS, AIF, OTHER.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bo-vm-type">Transaction type labels (one per line: purchase = BUY)</Label>
          <Textarea id="bo-vm-type" rows={4} value={type} onChange={(e) => setType(e.target.value)} placeholder="purchase = BUY" />
          <p className="text-xs text-muted-foreground">Allowed: BUY, SELL, SIP, REDEMPTION, DIVIDEND, SWITCH_IN, SWITCH_OUT, CHARGES, OTHER.</p>
        </div>
      </div>
      </PhoneSheet>

      <StickyActionBar label="Mapping actions">
        <Button onClick={save} disabled={pending} className="w-fit max-lg:w-full">{pending ? "Saving…" : "Save mapping"}</Button>
      </StickyActionBar>
    </div>
  );
}
