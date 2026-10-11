import { z } from "zod";

import { prisma } from "@/lib/db/prisma";

import { DEFAULT_FATIGUE_THRESHOLDS, type FatigueThresholds } from "./fatigue";
import { DEFAULT_WINNER_SETTINGS, type WinnerSettings } from "./winners";

/** Settings for this module, stored as small JSON documents in CreativeSetting. Every value has a default and a bound. */

const fatigueSchema = z.object({
  frequency: z.number().min(1).max(20),
  ctrDecayPct: z.number().min(1).max(95),
  cplDriftPct: z.number().min(1).max(500),
  windowDays: z.number().int().min(2).max(30),
  minDays: z.number().int().min(4).max(90),
  minImpressions: z.number().int().min(100).max(1_000_000),
  minLeads: z.number().int().min(1).max(1000),
});

const winnerSchema = z.object({
  minCreatives: z.number().int().min(3).max(100),
  minFundedTotal: z.number().int().min(3).max(10_000),
  minFundedPerWinner: z.number().int().min(1).max(100),
  sharedShare: z.number().min(0.4).max(1),
  liftPoints: z.number().int().min(5).max(100),
});

export const digestSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Email addresses written into the draft, and, where they match a user, who gets the in-app notice. */
  recipients: z.array(z.string().trim().toLowerCase().email().max(200)).max(20),
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = { enabled: false, recipients: [] };

async function read<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await prisma.creativeSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse({ ...(fallback as object), ...(JSON.parse(row.value) as object) });
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

async function write(key: string, value: unknown, userId: string) {
  await prisma.creativeSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value), updatedById: userId }, update: { value: JSON.stringify(value), updatedById: userId } });
}

export const getFatigueThresholds = (): Promise<FatigueThresholds> => read("fatigue_thresholds", fatigueSchema, DEFAULT_FATIGUE_THRESHOLDS);
export const getWinnerSettings = (): Promise<WinnerSettings> => read("winner_settings", winnerSchema, DEFAULT_WINNER_SETTINGS);
export const getDigestSettings = (): Promise<DigestSettings> => read("digest", digestSettingsSchema, DEFAULT_DIGEST_SETTINGS);

export async function saveFatigueThresholds(input: unknown, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = fatigueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "One of the thresholds is outside its allowed range." };
  await write("fatigue_thresholds", parsed.data, userId);
  return { ok: true };
}
export async function saveWinnerSettings(input: unknown, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = winnerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "One of the settings is outside its allowed range." };
  await write("winner_settings", parsed.data, userId);
  return { ok: true };
}
export async function saveDigestSettings(input: unknown, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = digestSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the recipient addresses." };
  await write("digest", parsed.data, userId);
  return { ok: true };
}
