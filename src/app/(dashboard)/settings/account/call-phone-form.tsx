"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOwnCallPhoneAction } from "@/app/(dashboard)/click-to-call/actions";

/** The phone Exotel rings first when you press Call on a client. */
export function CallPhoneForm({ current }: { current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [saved, setSaved] = useState(current ?? "");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      const result = await setOwnCallPhoneAction(value);
      if (result.ok) {
        setSaved(value.trim());
        toast.success(value.trim() ? "Calling number saved" : "Calling number removed");
      } else {
        toast.error(result.reason);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        type="tel"
        inputMode="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="98765 43210"
        aria-label="Your calling number"
        className="max-w-48"
      />
      <Button type="submit" variant="outline" disabled={pending || value.trim() === saved}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
