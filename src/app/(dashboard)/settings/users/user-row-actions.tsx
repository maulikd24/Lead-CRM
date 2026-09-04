"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AvailabilityStatus, Role, User } from "@/generated/prisma/client";
import {
  setUserRoleAction,
  setUserManagerAction,
  setUserCapacityAction,
  setUserAvailabilityAction,
  setUserRoutingTagsAction,
} from "./actions";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserActivationDialog } from "./user-activation-dialog";

const ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER"];
const AVAILABILITY_STATUSES: AvailabilityStatus[] = ["AVAILABLE", "ON_LEAVE", "UNAVAILABLE"];

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
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [regionsText, setRegionsText] = useState(user.regions.join(", "));
  const [languagesText, setLanguagesText] = useState(user.languages.join(", "));

  const managers = users.filter((u) => u.isActive && (u.role === "MANAGER" || u.role === "ADMIN"));

  function stageRoleChange(value: string | null) {
    if (!value) return;
    setPendingRole(value === user.role ? null : (value as Role));
  }

  async function handleSaveRole() {
    if (!pendingRole) return;
    setPending(true);
    try {
      await setUserRoleAction(user.id, pendingRole);
      toast.success(`${user.name}'s role updated to ${pendingRole}`);
      setPendingRole(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    } finally {
      setPending(false);
    }
  }

  function handleCancelRole() {
    setPendingRole(null);
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

  async function handleAvailabilityChange(value: string | null) {
    if (!value) return;
    setPending(true);
    try {
      const { reassigned } = await setUserAvailabilityAction(user.id, value as AvailabilityStatus);
      if (reassigned.length === 0) {
        toast.success(`${user.name} marked ${value.replace("_", " ").toLowerCase()}`);
      } else {
        const moved = reassigned.filter((r) => r.newRmId);
        const unassigned = reassigned.filter((r) => !r.newRmId);
        const parts = [
          moved.length > 0 ? `${moved.length} client(s) reassigned` : null,
          unassigned.length > 0 ? `${unassigned.length} left unassigned — no eligible RM` : null,
        ].filter(Boolean);
        toast.success(`${user.name} marked ${value.replace("_", " ").toLowerCase()}: ${parts.join("; ")}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update availability");
    } finally {
      setPending(false);
    }
  }

  function parseTags(value: string): string[] {
    return value.split(",").map((t) => t.trim()).filter(Boolean);
  }

  async function saveRoutingTags(next: { regions?: string[]; languages?: string[]; handlesHni?: boolean }) {
    setPending(true);
    try {
      await setUserRoutingTagsAction(user.id, {
        regions: next.regions ?? parseTags(regionsText),
        languages: next.languages ?? parseTags(languagesText),
        handlesHni: next.handlesHni ?? user.handlesHni,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update routing tags");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <Select value={pendingRole ?? user.role} onValueChange={stageRoleChange} disabled={pending || isSelf}>
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

      {pendingRole && (
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="default" title="Save role" disabled={pending} onClick={handleSaveRole}>
            <Check className="size-4" />
          </Button>
          <Button size="icon-sm" variant="outline" title="Cancel" disabled={pending} onClick={handleCancelRole}>
            <X className="size-4" />
          </Button>
        </div>
      )}

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

      {user.role === "RM" && (
        <Select value={user.availabilityStatus} onValueChange={handleAvailabilityChange} disabled={pending}>
          <SelectTrigger className="w-28 h-8 text-xs">
            <SelectValue>{(v: string) => v.replace("_", " ")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {AVAILABILITY_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {user.role === "RM" && (
        <>
          <Input
            className="w-28 h-8 text-xs"
            placeholder="Regions"
            title="Comma-separated regions this RM covers (blank = any)"
            value={regionsText}
            disabled={pending}
            onChange={(e) => setRegionsText(e.target.value)}
            onBlur={() => saveRoutingTags({ regions: parseTags(regionsText) })}
          />
          <Input
            className="w-28 h-8 text-xs"
            placeholder="Languages"
            title="Comma-separated languages this RM covers (blank = any)"
            value={languagesText}
            disabled={pending}
            onChange={(e) => setLanguagesText(e.target.value)}
            onBlur={() => saveRoutingTags({ languages: parseTags(languagesText) })}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" title="Eligible for HNI-tier lead routing">
            <input
              type="checkbox"
              checked={user.handlesHni}
              disabled={pending}
              onChange={(e) => saveRoutingTags({ handlesHni: e.target.checked })}
            />
            HNI
          </label>
        </>
      )}

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
