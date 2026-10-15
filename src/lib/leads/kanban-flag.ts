/** The Leads pipeline board (/leads) ships dark: on only when NEXT_PUBLIC_KANBAN is exactly "1". The Clients list is unchanged either way. */
export function kanbanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_KANBAN === "1";
}
