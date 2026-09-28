# Supportify WhatsApp worker

Always-on companion to the CRM's **Inbox**. It keeps one WhatsApp Web session per RM number alive
(via [Openwa](https://github.com/open-wa/wa-automate-nodejs) v5 alpha), pushes messages/QR/status to the CRM,
and sends the replies RMs type in the CRM. It has **no public URL and no database credentials** — it only
makes outbound HTTPS calls to the CRM, signed with a shared secret.

> ## ⚠ Read this first: status and risks
>
> **1. This runs on Openwa v5 alpha (`5.0.0-alpha.8`), pinned exactly.** The stable line, `4.76.0` (Feb 2025),
> does not connect to today's WhatsApp Web (tested 28 Sep 2026: it times out waiting for WhatsApp Web's
> `window.Debug`, even with a bare `create()`), so the worker uses the v5 packages
> (`@open-wa/core`, `@open-wa/client`, `@open-wa/driver-puppeteer`). v5 is **alpha software**: expect API changes
> and bugs, and upgrade one number at a time.
> **What was verified against real WhatsApp Web:** the browser launches, WhatsApp Web loads, a real QR code is
> produced, it rotates (every 20 s after the first minute), and it reaches the CRM and renders in
> Settings → WhatsApp Accounts. **What could not be verified:** anything after a phone scans the QR — login,
> receiving, sending, delivery ticks, logout — because that needs a real WhatsApp number. Openwa v5 also logged a
> warning before login that one of its listener bridges (`OpenWA_RuntimeStateChanged`) was deferred until after
> login; whether it activates cleanly is untested. Treat the first real link as a test, on a non-critical number.
>
> **2. Openwa is unofficial.** It automates WhatsApp Web; it is not affiliated with WhatsApp/Meta. Numbers
> driven this way can be restricted or banned, and WhatsApp's terms do not permit it. For a regulated business
> the official WhatsApp Cloud API (already integrated in the CRM's Meta adapter) is the supported route.
>
> **3. Swapping the engine is cheap.** Only `src/session-child.ts` and `src/handlers.ts` know about Openwa. The
> supervisor, CRM protocol, outbox, retry/backoff, health checks and crash-loop protection are engine-agnostic.
>
> **4. Prerequisites:** Node.js **22+** and the **`zstd`** command-line tool (Openwa v5 refuses to load without
> it; the worker checks at startup). The Docker image has both.

## Architecture

```
 RM phone ⇄ WhatsApp ⇄ [session process rm_1] ─┐
                        [session process rm_2] ─┼─ IPC ─▶ supervisor ── signed HTTPS ──▶ CRM (Vercel)
                        [session process rm_3] ─┤          (index.ts)     events  ▶ POST /api/internal/whatsapp/events
                        [session process rm_4] ─┘                         outbox  ◀ GET  /api/internal/whatsapp/outbox
                                                                          result  ▶ POST /api/internal/whatsapp/outbox/:id/result
```

**One OS process per number.** A crash or hang in one browser must not take down the other three, so each
number runs in its own child process and the supervisor restarts it.

- **Restart policy:** exponential backoff 5s → 10s → 20s → 40s → … capped at 5 min. **5 crashes within 10
  minutes pauses that number** (status `FAILED` in the CRM) until the worker is restarted — repeatedly
  re-launching a banned or broken number can make things worse. A phone-side "log out" restarts promptly
  (fresh QR) and is not counted as a crash.
- **Liveness:** each child pings every 10s; a silent child is killed and restarted. Each child also health-
  checks its browser every 60s.
- **Sending** is serialized per number with a minimum gap plus jitter (`SEND_MIN_INTERVAL_MS`).
- **Delivery to the CRM** is batched, ordered and retried; if the CRM is unreachable events are buffered in
  memory (bounded at 5,000) and flushed when it returns. Heartbeats and QR codes are latest-wins.
- **Sends are at-least-once.** If the worker dies between WhatsApp accepting a message and reporting the
  result, the CRM re-claims it after 60 s and it can be sent twice. The `fromMe` echo Openwa produces also
  marks such a message sent, which narrows the window.

## Setup

1. **CRM side.** Generate a secret (`openssl rand -hex 32`) and add it as `WHATSAPP_WORKER_SECRET` in the CRM's
   environment (Vercel → Settings → Environment Variables → Production), then redeploy. In the CRM go to
   **Settings → WhatsApp Accounts** and add one account per number: a label, a Session ID (e.g. `rm_1`), and
   the owning RM. New leads that message a number are assigned to its owner.
2. **Worker host.** Any always-on machine with Docker and enough RAM (see below) — a small VPS, Railway, Fly,
   etc. It only needs outbound internet access.
   ```bash
   cd whatsapp-worker
   cp env.example .env          # set CRM_BASE_URL, WHATSAPP_WORKER_SECRET, SESSION_IDS
   docker compose up -d --build
   docker compose logs -f
   ```
3. **Link the numbers.** In the CRM, open **Settings → WhatsApp Accounts → Connect / QR** (an RM can do their
   own from **Settings → My WhatsApp**). On the phone: WhatsApp → Settings → Linked devices → Link a device.
   Keep the session alive for several minutes after scanning before restarting anything.

Without Docker: install Node 22+, `zstd` and Chrome/Chromium, then `npm ci && npm run build && npm start`
(set `CHROME_PATH` to the browser binary).
For development `npm run dev` runs from source with `tsx`.

> The Docker image has **not been built or run** by the author of this change (no Docker on the dev machine).
> Expect to iterate on it once, in particular the Chromium install and running as a non-root user.

## Resources and operating tips

- **RAM/CPU:** budget roughly **0.5–1 GB RAM per number** (a Chromium instance plus Node) — about 4 GB and 2 vCPUs
  for four numbers. These are estimates, not measurements: watch `docker stats` under real traffic.
- **`shm_size: 1gb`** is set because Chromium crashes with Docker's default 64 MB `/dev/shm`.
- **Staggered boot:** numbers start `START_STAGGER_MS` (20 s) apart; parallel launches spike CPU/RAM.
- **Persist `/data/sessions`** (compose does, via a named volume) so restarts reconnect without a new QR. Openwa v5
  keeps one browser profile per session there (`_IGNORE_<sessionId>`). Back it up if losing the linked sessions
  would be painful.
- **QR handling:** Openwa v5 alpha emits its QR event only once, so the worker reads the rotating code from the
  page every 5 s, renders it to an image, and re-sends an unchanged code every 30 s so the CRM never shows a stale
  one. A code nobody scans for 10 minutes recycles the browser; that is normal and not counted as a crash.
- **Long-running Chromium leaks memory.** A scheduled nightly restart (`0 4 * * * docker compose restart`) is a
  cheap safeguard; the CRM shows numbers offline for the few minutes it takes.
- **Monitoring:** the CRM marks a number offline if it hears no heartbeat for 5 minutes and notifies Admins.
  Check `docker compose logs` for `Crash loop` (a paused number) and `401` (secret/clock mismatch).
- **Clock:** requests are rejected if this host's clock differs from the CRM's by more than 5 minutes. Run NTP.
- **Upgrading Openwa:** all three `@open-wa/*` packages are pinned to the same exact alpha version in `package.json`.
  Move them together and test on one number first.

## Security and privacy

- The QR code controls the WhatsApp number. It is never printed to logs or uploaded anywhere; it only travels to
  your CRM, which shows it to Admins and to that number's own RM only.
- The worker does **not** enable Openwa's optional remote features: `patchConfig` (downloads patches from
  cdn.openwa.dev and runs them inside the WhatsApp Web page) and license checks (funcs.openwa.dev) are left off.
- Logs contain ids, counts and states — **never message text or phone numbers.** Openwa v5's own debug/info log
  lines (which include the page's console output) are dropped by the supervisor; only its warnings and errors pass.
- Media messages forward only the caption (Openwa's `body` is base64 file content for media, which is never sent).
  Media files are not stored in v1.
- Only 1:1 chats with a real phone number are forwarded: groups, status broadcasts, channels and privacy-masked
  `@lid` chats are dropped. Messages older than `MAX_MESSAGE_AGE_SECONDS` (15 min) are dropped so a first-time
  link's history sync cannot create stale leads.

## What has been tested

Against the real CRM (local dev), using `npm run simulate:whatsapp -- smoke` at the CRM root (47 checks —
auth, ingestion, idempotency, outbox, RBAC, reassignment, QR) plus these worker-level runs with a stub
standing in for the Openwa child:
- The worker's own HMAC signing is accepted by the CRM; account status, heartbeat, QR (then cleared on connect)
  and an inbound message (auto-created lead assigned to the number's owner) all arrived.
- A reply queued in the CRM was claimed, "sent", reported, and delivery-acked within ~2 s, with exactly one row.
- `SIGTERM` shuts down cleanly with no orphaned processes.
- A child that always crashes shows the 5s/10s/20s/40s backoff, then the crash-loop pause, and the CRM records
  `FAILED` with the reason.

Real Openwa v5 run (headless Chrome 154, macOS): browser launch → WhatsApp Web → QR produced, rotating and shown
in the CRM's QR dialog; `SIGTERM` leaves no browser processes behind.

**Not tested:** anything after a phone scans the QR (login, receive, send, acks, logout, restart-reconnects-without-
QR), the Docker image, and long-running memory behaviour.

## Real-device test checklist

1. Link a number; CRM shows `CONNECTED` and the number.
2. From another phone message that number — a new lead appears in the Inbox, assigned to the owning RM.
3. Reply from the CRM Inbox — arrives on the customer's phone; ticks advance sent → delivered → read.
4. Reply from the RM's own phone — appears in the Inbox tagged "from phone", once.
5. Message from a number already in the CRM (different formatting, e.g. with/without +91) — same thread.
6. Reassign the lead to another RM — the first RM loses it, the second gains it, replies still leave from the
   original number.
7. Stop the worker for 6+ minutes — the number shows offline and Admins get a notification; restart and it recovers
   without a new QR.
8. Send a group message and a status update to the number — neither appears in the CRM.

## Configuration

See `env.example` for every variable with its default and rationale.
