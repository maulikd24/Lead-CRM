export type EmailChangeDeps = {
  ssoEnabled: boolean;
  /** Case-insensitive lookup of ANOTHER user holding this email. */
  findOtherUserByEmail: (email: string, exceptUserId: string) => Promise<{ id: string } | null>;
};

/**
 * Self-service email change. The email is the single-sign-on matching key, so while SSO is enabled users cannot
 * rewrite it; and uniqueness is always checked case-insensitively so nobody can create a case-variant duplicate.
 */
export async function checkOwnEmailChange(
  userId: string,
  currentEmail: string,
  requestedEmail: string,
  deps: EmailChangeDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (requestedEmail === currentEmail) return { ok: true };
  if (deps.ssoEnabled) return { ok: false, message: "Your email is managed by single sign-on" };
  if (await deps.findOtherUserByEmail(requestedEmail, userId)) return { ok: false, message: "A user with this email already exists" };
  return { ok: true };
}
