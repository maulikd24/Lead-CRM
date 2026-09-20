"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { searchClientsForHouseholdAction, addHouseholdMemberAction } from "../actions";

type ClientResult = { id: string; name: string; clientCode: string; mobile: string | null };

export function AddMemberDialog({ householdId }: { householdId: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientResult[]>([]);
  const [selected, setSelected] = useState<ClientResult | null>(null);
  const [relationship, setRelationship] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleSearch(value: string) {
    setQuery(value);
    setSelected(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setResults(await searchClientsForHouseholdAction(value, householdId));
  }

  function handleAdd() {
    if (!selected) return;
    startTransition(async () => {
      try {
        await addHouseholdMemberAction(householdId, selected.id, { relationship: relationship || undefined, isPrimary });
        toast.success(`${selected.name} added to household`);
        setOpen(false);
        setQuery("");
        setResults([]);
        setSelected(null);
        setRelationship("");
        setIsPrimary(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add member");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <UserPlus className="size-4" />
        Add Member
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Household Member</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="member-search">Search client</FieldLabel>
            <Input
              id="member-search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Name, mobile, or client code"
            />
          </Field>
          {results.length > 0 && !selected && (
            <div className="flex flex-col gap-1 rounded-md border p-1">
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelected(c)}
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {c.name} <span className="font-mono text-xs text-muted-foreground">{c.clientCode}</span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <>
              <p className="text-sm">
                Adding <span className="font-medium">{selected.name}</span> ({selected.clientCode})
              </p>
              <Field>
                <FieldLabel htmlFor="relationship">Relationship (optional)</FieldLabel>
                <Input
                  id="relationship"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  placeholder="Self / Spouse / Child / Parent"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox id="is-primary" checked={isPrimary} onCheckedChange={(v) => setIsPrimary(v === true)} />
                <FieldLabel htmlFor="is-primary" className="font-normal">
                  Primary member
                </FieldLabel>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button onClick={handleAdd} disabled={!selected || pending}>
            {pending ? "Adding..." : "Add to Household"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
