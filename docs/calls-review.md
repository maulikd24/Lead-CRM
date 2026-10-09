# Call recordings review (`/calls`)

A calm workspace for listening back to calls, reading transcripts and reviewing how each call went. It reads data that is
already ingested; it never calls the telephony provider or an AI model.

## Switching it on

| Setting | Default | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_CALLS_REVIEW` | off (only `1` enables it) | Build-time flag. Shows the **Call recordings** item in the sidebar (admins and managers) and serves `/calls`, `/calls/[id]` and `/api/calls/[id]/recording`. Off, all three return 404. Changing it needs a rebuild. |
| `CALLS_RECORDING_HOSTS` | empty | Optional comma-separated extra hostnames the recording proxy may fetch from, in addition to the telephony provider's own domain. |

## Who sees what

Admins see every call. Managers see their own and their direct reports' calls. RMs see their own calls. A call is visible
when the RM on its review, the user who logged it, or the customer's assigned RM is in the viewer's scope (same
`getVisibleUserIds` the rest of the app uses). A call outside the scope returns the same 404 as one that does not exist.
RMs can open `/calls` directly; the sidebar item is for admins and managers only.

## Data it uses (no migration)

- `Activity` of type `CALL`: direction, status, duration and, for provider calls, `payload.recordingUrl`.
- `ConversationReview` (one per call): transcript, sentiment, quality score and per-criterion breakdown, recommendation,
  and the existing review fields (`reviewedById`, `reviewedAt`, `reviewNotes`, `overriddenScore`, `taskId`).
- `ConversationInsight` (source `CALL`): commitments, objections and the concern kinds behind the flag chips.

Flag chips: Missed follow-up (a missed-opportunity insight, or an open commitment past its due date), Compliance concern,
Incorrect info, Complaint. Dismissed insights are ignored.

The list covers the last 90 days, up to 500 calls. Filters and the manager rollup (average score by RM, top flags) work on
that same set, so the numbers always describe the calls listed.

## Recordings

The browser never receives the provider's URL. The player points at `/api/calls/[id]/recording`, which checks the session
and the visibility rule, then streams the audio from the provider with `Range` support (seeking) and
`Cache-Control: private, no-store`. Only `https` URLs on the provider's domain (plus `CALLS_RECORDING_HOSTS`) are fetched,
never URLs with embedded credentials, and redirects are followed only to other allowed hosts. Non-audio responses are
refused. The request carries no credentials: this works while the provider's recording links are pre-signed or public. If
the provider requires authentication for recordings, that credential has to be added server-side to the proxy; it must not
be put in the stored URL. Recordings stored from the Android app are not available (the app syncs call metadata only).

## Privacy

Customers are shown by name only; no phone numbers appear anywhere. Transcripts, summaries and notes are masked on the
server before they reach the browser (phone-like numbers, e-mail addresses, PAN). The stored transcript is unchanged.
The summary is the AI's stored sentiment reasoning, labelled as AI-written.

## Actions

- **Create follow-up task**: uses the existing task helper, one open task per call (a double click cannot make two).
  Anyone who can see the call can create it; it is assigned to the call's RM.
- **Mark reviewed** with a reviewer note: admins and managers, after the call has been analysed.
