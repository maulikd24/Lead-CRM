import { config } from "./config";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

// Message bodies and phone numbers are customer data — log ids, counts and states only, never content.
function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`;
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
