import { encryptJson, decryptJson } from "./crypto";

/** Encrypts a plain string field for storage — null/empty passes through unchanged. */
export function encryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  return encryptJson(value);
}

/** Decrypts a field written by encryptField(). Returns null for null/empty input. */
export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  return decryptJson<string>(value);
}
