# Front door (landing and sign-in)

Flags (both off by default): `NEXT_PUBLIC_LANDING` (landing at `/` for signed-out visitors and the redesigned `/login`) and `GOOGLE_SIGNIN_ENABLED` (company Google sign-in).

- Google sign-in: existing active users only; Workspace domain claim required; allowed domains and the trust-strip sign-off are edited in Settings, Sign-in (Admin only, audited). The Google client id and secret are environment values entered by the admin.
- Theme: light by default, system preference on the first visit, a header toggle remembers the choice (`fd-theme` in local storage, optional).
- Trust strip: its wording lives only in `src/lib/front-door/trust-config.ts` (compliance review: pending). It is not rendered until an Admin records the reviewer's name and date; changing the wording invalidates the sign-off.
- Licence credit: Allvest Customer OS is built on Supportify (open source), https://github.com/maulikd24/Lead-CRM. It is shown on Settings, Account (About) and here, not on the public pages.
