"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role, User } from "@/generated/prisma/client";
import { setUserRoleAction, setUserManagerAction, setUserCapacityAction } from "./actions";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserActivationDialog } from "./user-activation-dialog";

const ROLES: Role[] = ["ADMIN", "MANAGER", "RM"];

export function UserRowActions({
  user,
  users,
  isSelf,
}: {
  user: User;
  users: Pick<User, "id" | "name" | "role" | "isActive">[];
  isSelf: boolean;
}) {
  const [pending, setPending] = useState(false);

  const managers = users.filter((u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"));

  async function handleRoleChange(value: string | null) {
    if (!value) return;
    setPending(true);
    try {
      await setUserRoleAction(user.id, value as Role);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setPending(false);
    }
  }

  async function handleManagerChange(value: string | null) {
    setPending(true);
    try {
      await setUserManagerAction(user.id, value || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update manager");
    } finally {
      setPending(false);
    }
  }

  async function handleCapacityBlur(value: string) {
    const parsed = value.trim() === "" ? null : Number(value);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) return;
    setPending(true);
    try {
      await setUserCapacityAction(user.id, parsed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update capacity");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Select value={user.role} onValueChange={handleRoleChange} disabled={pending || isSelf}>
        <SelectTrigger className="w-28 h-8 text-xs">
          <SelectValue>{(v: string) => v}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={user.managerId ?? ""} onValueChange={handleManagerChange} disabled={pending || isSelf}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue placeholder="No manager">
            {(v: string) => managers.find((m) => m.id === v)?.name ?? "No manager"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {managers.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        key={user.capacity ?? "empty"}
        type="number"
        min={1}
        className="w-16 h-8 text-xs"
        placeholder="Cap"
        defaultValue={user.capacity ?? ""}
        disabled={pending}
        onBlur={(e) => handleCapacityBlur(e.target.value)}
      />

      <ResetPasswordDialog userId={user.id} userName={user.name} />

      <UserActivationDialog user={user} disabled={isSelf} />
    </div>
  );
}
