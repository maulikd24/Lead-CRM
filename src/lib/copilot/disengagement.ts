/** A live client with no activity, message or other contact for this many days is "disengaged". One number for the daily check, the Co-pilot count and the Clients filter. */
export const DISENGAGED_AFTER_DAYS = 5;

export const disengagedCutoff = (now: Date = new Date()): Date => new Date(now.getTime() - DISENGAGED_AFTER_DAYS * 24 * 60 * 60 * 1000);
