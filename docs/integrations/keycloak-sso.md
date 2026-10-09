# Single sign-on with Keycloak (OpenID Connect)

Audience: the identity administrator who runs Keycloak, and the app team who deploy Supportify.
One Keycloak login can serve Supportify and any other app registered in the same realm.

Single sign-on is off by default. With the flag unset, or any required value missing, the sign-in page and flow behave exactly as before.

## 1. How it works

- The user clicks "Sign in with SSO" on the sign-in page and authenticates at Keycloak (authorization code flow with PKCE, `state` and `nonce`).
- Supportify reads the `email` and `email_verified` claims and looks for an existing, active Supportify user with the same email (case-insensitive).
- If found, the user is signed in with the role, name and email stored in Supportify. Nothing else from the token is used.
- If not found, the user sees "No access. Contact your administrator." and the attempt is recorded in the sign-in audit log.

Rules that always apply:

- No auto-provisioning. A person who can log in to Keycloak but has no Supportify user is refused. Create the user in Supportify first.
- Roles are never taken from the token. Changing a role in Keycloak has no effect; change it in Supportify.
- Inactive users and users locked out by repeated password failures are refused.
- The email must be present and `email_verified` must be the boolean `true`.
- The user never learns why a refusal happened (unknown email, unverified email, inactive, locked all look the same). The audit log records the reason.

### Email matching, on purpose

- Case is ignored: `Jane@Example.com` matches `jane@example.com`. If two Supportify users differ only by case, SSO refuses both (ambiguous) until an administrator fixes the data.
- A plus-suffix is NOT ignored: `jane+crm@example.com` does not match `jane@example.com`. A plus address is a different mailbox, so treating it as the same person would let anyone who can register such an address in Keycloak take over an account. The Keycloak email must equal the Supportify email.
- Only plain ASCII emails are matched. An email containing any non-ASCII character (for example the Kelvin sign, fullwidth letters, look-alike letters, zero-width or control characters) is refused, because Unicode lowercasing can fold such characters onto ASCII letters and let one person impersonate another. The same rule applies to the break-glass list.
- While SSO is enabled, users cannot change their own email in the account settings (an administrator changes it), because the email is the matching key.

## 2. What the Keycloak administrator creates

1. A realm (or use an existing one). The issuer URL has this form and must be given exactly as Keycloak publishes it:
   `https://<keycloak-host>/realms/<realm>`
   (older Keycloak versions with a path prefix: `https://<keycloak-host>/auth/realms/<realm>`). It must be https.
2. A confidential client:
   - Client type: OpenID Connect. Client authentication: ON (confidential). Standard flow: ON. Direct access grants, implicit flow and service accounts: OFF.
   - Valid redirect URIs: `https://<supportify-host>/api/auth/callback/keycloak` (exact, no wildcard).
   - Valid post logout redirect URIs: `https://<supportify-host>/login`.
   - Web origins: `https://<supportify-host>`.
   - PKCE method: S256 (recommended; Supportify always sends it).
3. Claims in the ID token: the standard `email` and `email_verified` mappers must be on (the built-in `email` client scope does this). Make sure real users have a verified email in Keycloak. Add no role mappers; they are ignored.
5. Realm hardening that email matching depends on. Supportify trusts the verified email, so the realm must not let anyone obtain a verified email they do not own:
   - Self-registration off (or, if it must stay on, "Verify email" on).
   - "Duplicate emails" OFF.
   - Users cannot change their email without re-verification (keep "Verify email" on, and do not let users edit email unverified).
   - "Trust email" OFF on every brokered (federated) identity provider.
   - Restrict who can obtain tokens for this client (for example with a client role or an authentication flow condition), so only intended staff can sign in at all.
4. Token lifetimes: the default is fine. Supportify tolerates 30 seconds of clock difference with Keycloak; keep both servers on NTP.

## 3. Values to give the app team

| Setting | Value |
|---|---|
| `KEYCLOAK_ISSUER` | the issuer URL from step 1 |
| `KEYCLOAK_CLIENT_ID` | the client id |
| `KEYCLOAK_CLIENT_SECRET` | the client secret (send it through your secret manager, never in chat or email) |

## 4. Supportify settings (app team)

All are server environment variables.

| Variable | Meaning |
|---|---|
| `SSO_ENABLED=1` | Master switch. Anything other than exactly `1` leaves SSO off. |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | Required. If any is missing, or the issuer is not https (http is accepted only for localhost), SSO stays off. |
| `SSO_ONLY=1` | Optional. Hides the password form and refuses password sign-ins for everyone except the break-glass list. Ignored when SSO itself is off, so a half-configured environment can never lock everyone out. |
| `SSO_BREAK_GLASS_EMAILS` | Optional comma-separated emails (case-insensitive, exact) that may still use a password when `SSO_ONLY=1`. |
| `AUTH_URL` | The public base URL of Supportify. Used for the post-logout redirect. |

Issuer pinning: the issuer in Keycloak's discovery document and in every ID token must equal `KEYCLOAK_ISSUER`, otherwise the sign-in is refused.

### Sessions

Supportify sessions are signed cookies, not server-side sessions. With SSO enabled an SSO session has an absolute lifetime of 8 hours from sign-in, counted from the moment of sign-in and not extended by activity (Auth.js renews the cookie on every request, so Supportify checks the sign-in time itself). After that the user signs in again (a quick redirect if the Keycloak session is still alive). There is no refresh token. Every request re-reads the user from Supportify, so deactivating a user, changing a role, a password change or "sign out everywhere" take effect on the next request. Ending a session in Keycloak does not end Supportify sessions that are already open; deactivate the Supportify user for an immediate cut-off. Without SSO the previous default session lifetime is unchanged.

Sign-out: for users who signed in through SSO, signing out also redirects to the Keycloak logout endpoint (with `id_token_hint` when available, otherwise `client_id`) and then back to the sign-in page. If that cannot be built the user is signed out locally only. The `id_token_hint` is part of that URL, so it can appear in Keycloak access logs and browser history; it is a short-lived signed token that identifies the user but cannot be used to sign in.

SSO users are not asked to change a password on first login, and SSO sign-ins are independent of the password lockout: a locked-out password account can still use SSO (inactive users cannot), and an SSO sign-in does not reset the password-failure counter, so SSO use gives a password guesser no fresh attempts. This also means break-glass administrators cannot be locked out of SSO by guessing. They do update "last login" and are written to the sign-in audit log like password sign-ins.

## 5. Test with a test user

1. In a non-production realm, create a Keycloak user with a verified email, for example `sso.tester@example.com`.
2. In Supportify (staging), create a user with the same email and a low-privilege role.
3. Set the variables in section 4 on staging and restart.
4. Open the sign-in page: the lime "Sign in with SSO" button appears next to the password form.
5. Sign in. You should land on the dashboard as that Supportify user.
6. Negative checks: a Keycloak user with no Supportify user, an unverified email, and a deactivated Supportify user must each end on "No access. Contact your administrator." Check the sign-in audit log shows the reason (`sso unknown user`, `sso email unverified`, `sso inactive user`).
7. Sign out: you should be returned to the sign-in page and be asked for credentials again at Keycloak.

## 6. Break-glass procedure

If Keycloak is down or misconfigured while `SSO_ONLY=1`:

1. List one or two named administrators in `SSO_BREAK_GLASS_EMAILS`. Give each a strong, unique Supportify password stored in the password manager.
2. A break-glass administrator opens `https://<supportify-host>/login?breakglass=1`, which shows the password form, and signs in.
3. Every break-glass sign-in is in the audit log. Review it after each use and rotate the password.
4. To switch SSO off completely, unset `SSO_ENABLED` (or `SSO_ONLY`) and restart.

Keep the list short and review it every quarter.

## 7. Rollout steps

1. Keycloak side: create the client (section 2) and a test user.
2. Staging: enable SSO for testing (section 5).
3. Production, step one: set `SSO_ENABLED=1` with the three values but NOT `SSO_ONLY`. Ask the administrators to use the SSO button for a week. Passwords keep working for everyone.
4. Make sure every person who should have access has a Supportify user whose email equals their Keycloak email.
5. Production, step two: roll out to the rest of the team.
6. Optional hardening: set `SSO_ONLY=1` with a short `SSO_BREAK_GLASS_EMAILS` list.
7. Rollback at any time: unset `SSO_ENABLED` and restart. Nothing is stored in the database for SSO, so there is nothing to undo. Existing SSO sessions end on their next request once SSO is off (users sign in again with a password). Conversely, switching on `SSO_ONLY` ends existing password sessions of everyone not on the break-glass list.

## 8. Security notes

- Redirects after sign-in and sign-out are restricted to same-origin paths; no external redirect is ever accepted from request input. The one external redirect, to the Keycloak logout endpoint, is built on the server from the configuration and the stored ID token.
- Tokens and claims are never logged. The audit log stores the email, the outcome and a short reason code, the same as for password sign-ins.
- The ID token is kept inside the encrypted session cookie only to build the logout URL and is never sent to the browser as part of the session data.
- The client secret lives only in server environment variables.
- Before turning on `SSO_ONLY`, consider binding the Keycloak subject (`sub`) to the user on first SSO sign-in; this is a planned follow-up that needs an additive column.
- Password sign-ins made while `SSO_ONLY` is on are tagged `breakGlass` in the audit log.
