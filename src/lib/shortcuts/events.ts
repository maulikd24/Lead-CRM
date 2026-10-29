/**
 * One window event for the app shell, so the + New menu, the shortcut listener and the Help menu can ask the palette, the menu or the
 * shortcut overlay to open without sharing React state across the header.
 */
export const SHELL_EVENT = "crm:shell";

export type ShellCommand = { type: "palette"; mode?: "task" | "call" } | { type: "new-menu" } | { type: "shortcuts" };

export function dispatchShell(command: ShellCommand): void {
  window.dispatchEvent(new CustomEvent<ShellCommand>(SHELL_EVENT, { detail: command }));
}

/** Subscribe to shell commands; returns the unsubscribe. */
export function onShell(listener: (command: ShellCommand) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<ShellCommand>).detail);
  window.addEventListener(SHELL_EVENT, handler);
  return () => window.removeEventListener(SHELL_EVENT, handler);
}
