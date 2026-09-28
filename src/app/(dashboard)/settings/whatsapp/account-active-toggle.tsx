"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setWhatsAppAccountActiveAction } from "./actions";

export function AccountActiveToggle({ accountId, isActive }: { accountId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      try {
        await setWhatsAppAccountActiveAction(accountId, !isActive);
        toast.success(isActive ? "Account deactivated" : "Account activated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update account");
      }
    });
  }

  return (
    <Button size="sm" variant="ghost" onClick={toggle} disabled={pending}>
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
