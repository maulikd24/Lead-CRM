-- SYNTHETIC LEGACY DATA for the original schema (upstream main's migrations only).
-- Everything here is made up: no real person, number, e-mail or credential. Mobiles all sit in the reserved synthetic
-- range 9000xxxxxx, e-mails end in @example.invalid, password hashes are a placeholder no login can match, URLs use
-- example.invalid. run.mjs asserts all of that after loading, so this file can never be pointed at real data by mistake.
--
-- Run by run.mjs with:  psql -v clients=.. -v leads=.. -v activities=.. -v messages=.. -v anchor=<timestamptz> -f seed-legacy.sql
-- Deterministic: the same arguments give byte-identical rows (setseed, a fixed time anchor instead of now()).
-- Messy on purpose: phone formats, duplicate contacts, null-heavy rows, soft-deleted and merged rows, locked users,
-- unicode, very long and empty text. Scale knob: run.mjs LEGACY_SCALE (1 is about 0.4M rows, 10 about 4M).

\set ON_ERROR_STOP on
SELECT setseed(0.4242);
SELECT set_config('ci.anchor', :'anchor', false);
CREATE FUNCTION pg_temp.anchor() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('ci.anchor')::timestamptz $$;
-- the only mobile numbers this file ever produces: 9000 + six digits
CREATE FUNCTION pg_temp.syn_mobile(n bigint) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '9000' || lpad((n * 7 % 1000000)::text, 6, '0') $$;

-- the identity rule of src/lib/clients/identity-keys.ts (phoneKey / emailKey) -------------------------------
CREATE FUNCTION pg_temp.phone_key(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(raw, '\D', '', 'g');
  IF d LIKE '00%' THEN d := substr(d, 3); END IF;
  IF length(d) = 13 AND d LIKE '910%' THEN RETURN substr(d, 4); END IF;
  IF length(d) = 12 AND d LIKE '91%' THEN RETURN substr(d, 3); END IF;
  IF length(d) = 11 AND d LIKE '0%' THEN RETURN substr(d, 2); END IF;
  IF length(d) >= 8 THEN RETURN d; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION pg_temp.pick(a text[], r double precision) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT a[1 + floor(r * array_length(a, 1))::int] $$;

-- stages (the six baseline ones the app seeds) ---------------------------------------------------------------
INSERT INTO "Stage" (id, name, sequence, "slaHours", "isActive") VALUES
 ('syn_st_1','New Lead',1,4,true),('syn_st_2','Submitted for KYC',2,24,true),('syn_st_3','KYC completed',3,72,true),
 ('syn_st_4','Pushed for funds',4,120,true),('syn_st_5','Introduction with Dealer',5,48,true),('syn_st_6','Onboarding Completed',6,0,true);

-- users in every role ------------------------------------------------------------------------------------------
-- (role, count, prefix)
CREATE TEMP TABLE syn_role_plan (role "Role", n int, prefix text);
INSERT INTO syn_role_plan VALUES
 ('ADMIN',3,'adm'),('MANAGER',6,'mgr'),('RM',40,'rm'),('DEALER',4,'dlr'),('TEAM_MANAGER',4,'tmg'),
 ('PARTNER',60,'prt'),('AFFILIATE',40,'aff'),('DISTRIBUTOR',20,'dst'),('FINANCE',3,'fin');

INSERT INTO "User" (id, name, email, "passwordHash", role, "isActive", capacity, "availabilityStatus", regions, languages,
                    "handlesHni", "hasSeenTour", "lastLoginAt", "failedLoginAttempts", "lockedUntil", "mustChangePassword",
                    "createdAt", "updatedAt")
SELECT 'syn_u_' || p.prefix || '_' || g,
       initcap(p.prefix) || ' User ' || g,
       CASE WHEN g % 11 = 0 THEN upper(p.prefix || g || '@Example.invalid') ELSE p.prefix || g || '@example.invalid' END,
       'synthetic-placeholder-not-a-hash',
       p.role,
       NOT (g % 13 = 0),                                  -- some deactivated
       CASE WHEN p.role = 'RM' AND g % 5 <> 0 THEN 30 + g END,
       'AVAILABLE',
       CASE WHEN g % 4 = 0 THEN ARRAY['West'] ELSE ARRAY[]::text[] END,
       CASE WHEN g % 3 = 0 THEN ARRAY['Hindi','English'] ELSE ARRAY[]::text[] END,
       g % 7 = 0, g % 2 = 0,
       CASE WHEN g % 6 <> 0 THEN pg_temp.anchor() - (g || ' hours')::interval END,
       CASE WHEN g % 17 = 0 THEN 5 ELSE 0 END,
       CASE WHEN g % 17 = 0 THEN pg_temp.anchor() + interval '1 hour' END,
       g % 19 = 0,
       pg_temp.anchor() - interval '900 days' + (g || ' hours')::interval,
       pg_temp.anchor() - interval '5 days'
FROM syn_role_plan p, LATERAL generate_series(1, p.n) g;

-- reporting lines: every RM has a manager
UPDATE "User" u SET "managerId" = 'syn_u_mgr_' || (1 + (substring(u.id from '_(\d+)$')::int % 6))
 WHERE u.role = 'RM';

CREATE TEMP TABLE syn_rm AS
  SELECT row_number() OVER (ORDER BY id) AS i, id FROM "User" WHERE role = 'RM';
CREATE TEMP TABLE syn_adm AS SELECT id FROM "User" WHERE role = 'ADMIN' ORDER BY id LIMIT 1;
SELECT count(*) AS rm_count FROM syn_rm \gset

-- WhatsApp accounts -----------------------------------------------------------------------------------------------
INSERT INTO "WhatsAppAccount" (id, "sessionId", label, "ownerUserId", "phoneNumber", status, "isActive", "createdAt", "updatedAt")
SELECT 'syn_wa_' || i, 'rm_' || i, 'RM ' || i, id, pg_temp.syn_mobile(i + 900000), 'CONNECTED', true, pg_temp.anchor(), pg_temp.anchor()
FROM syn_rm WHERE i <= 12;

-- clients ---------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE syn_client_seed AS
SELECT g AS n,
       -- base mobile: 9 + 9 digits; duplicate contacts: every 33rd client reuses the contact of client (n - 500)
       CASE WHEN g > 500 AND g % 33 = 0 THEN g - 500 ELSE g END AS contact_n
FROM generate_series(1, :clients) g;

INSERT INTO "Client" (id, "clientCode", name, mobile, email, pan, "mobileKey", "emailKey", "ckycRef", region, "preferredLanguage", city, state,
                      "clientType", "investmentCategory", "leadSource", "leadAttribution", "customerCategory", "marketingConsentAt", "marketingConsentText",
                      "productInterest", "existingBroker", "tradingExperience", "expectedInvestment", "referralSource", notes, priority, status,
                      "currentStageId", "stageEnteredAt", "assignedToId", "createdAt", "updatedAt", "completedAt", "isDeleted", "deletedAt")
SELECT 'syn_cl_' || s.n,
       'CL-' || lpad(s.n::text, 6, '0'),
       -- messy names: padded, upper-case, lower-case, non-latin, single letter, empty-ish
       CASE s.n % 23
         WHEN 0 THEN upper(pg_temp.pick(ARRAY['Aarav','Vihaan','Isha','Diya','Kabir','Meera','Rohan','Ananya'], random()) || ' ' || pg_temp.pick(ARRAY['Sharma','Verma','Patel','Iyer','Nair','Gupta','Singh','Mehta'], random()))
         WHEN 1 THEN '  ' || pg_temp.pick(ARRAY['Aarav','Vihaan','Isha','Diya','Kabir','Meera','Rohan','Ananya'], random()) || '   ' || pg_temp.pick(ARRAY['Sharma','Verma','Patel','Iyer','Nair','Gupta','Singh','Mehta'], random()) || ' '
         WHEN 2 THEN 'राहुल ' || pg_temp.pick(ARRAY['शर्मा','वर्मा','पटेल'], random())
         WHEN 3 THEN lower(pg_temp.pick(ARRAY['aarav','vihaan','isha','diya'], random()) || ' ' || pg_temp.pick(ARRAY['sharma','verma','patel'], random()))
         WHEN 4 THEN 'X'
         ELSE pg_temp.pick(ARRAY['Aarav','Vihaan','Isha','Diya','Kabir','Meera','Rohan','Ananya','Saanvi','Arjun','Kavya','Neel'], random()) || ' '
              || pg_temp.pick(ARRAY['Sharma','Verma','Patel','Iyer','Nair','Gupta','Singh','Mehta','Joshi','Rao','Das','Shah'], random()) END,
       m.mobile, m.email, m.pan,
       pg_temp.phone_key(m.mobile),
       NULLIF(lower(btrim(m.email)), ''),
       CASE WHEN s.n % 10 = 0 THEN 'CK' || lpad(s.n::text, 12, '0') END,
       pg_temp.pick(ARRAY['West','South','North','East'], random()),
       CASE WHEN random() < 0.6 THEN pg_temp.pick(ARRAY['Hindi','English','Marathi','Tamil','Gujarati'], random()) END,
       CASE WHEN random() < 0.85 THEN pg_temp.pick(ARRAY['Mumbai','Pune','Delhi','Bengaluru','Chennai','Ahmedabad','Kolkata','Hyderabad'], random()) END,
       CASE WHEN random() < 0.7 THEN pg_temp.pick(ARRAY['Maharashtra','Delhi','Karnataka','Tamil Nadu','Gujarat','West Bengal'], random()) END,
       CASE WHEN random() < 0.6 THEN pg_temp.pick(ARRAY['Individual','HUF','Corporate','NRI'], random()) END,
       CASE WHEN random() < 0.7 THEN pg_temp.pick(ARRAY['Wealth','Broking','Wealth & Broking'], random()) END,
       pg_temp.pick(ARRAY['Meta Ads','Google Ads','Website','Referral','Walk-in','Partner','WhatsApp'], random()),
       CASE WHEN random() < 0.4 THEN jsonb_build_object('campaign', 'camp_' || (s.n % 40), 'utm_source', pg_temp.pick(ARRAY['fb','google','insta'], random()), 'platform', 'meta') END,
       CASE WHEN random() < 0.5 THEN pg_temp.pick(ARRAY['Broking','Wealth','Mutual Funds','HNI','Existing Customer','Support','Other'], random()) END,
       CASE WHEN random() < 0.3 THEN pg_temp.anchor() - ((random() * 700)::int || ' days')::interval END,
       CASE WHEN random() < 0.3 THEN 'I agree to be contacted.' END,
       CASE WHEN random() < 0.5 THEN pg_temp.pick(ARRAY['Stocks','Mutual Funds','PMS','AIF','Bonds'], random()) END,
       CASE WHEN random() < 0.3 THEN pg_temp.pick(ARRAY['Broker A','Broker B','Broker C','Broker D'], random()) END,
       CASE WHEN random() < 0.4 THEN pg_temp.pick(ARRAY['None','1-3 years','3-5 years','5+ years'], random()) END,
       CASE WHEN random() < 0.5 THEN round((random() * 5000000)::numeric, 0) END,
       CASE WHEN s.n % 15 = 0 THEN 'PTR-' || lpad((1 + s.n % 60)::text, 5, '0') WHEN s.n % 40 = 1 THEN 'ref friend' END,
       CASE WHEN random() < 0.25 THEN repeat('Call note. ', 1 + (random() * 6)::int) WHEN s.n % 200 = 0 THEN repeat('Very long note ', 400) END,
       (ARRAY['LOW','MEDIUM','HIGH'])[1 + floor(random()*3)::int]::"Priority",
       CASE WHEN random() < 0.78 THEN 'ACTIVE' WHEN random() < 0.5 THEN 'ON_HOLD' WHEN random() < 0.7 THEN 'COMPLETED' ELSE 'NOT_PROCEEDING' END::"ClientStatus",
       'syn_st_' || (1 + floor(power(random(), 1.6) * 6)::int),
       pg_temp.anchor() - ((random() * 400)::int || ' days')::interval,
       CASE WHEN random() < 0.9 THEN (SELECT id FROM syn_rm WHERE i = 1 + (s.n % :rm_count)) END,
       pg_temp.anchor() - interval '730 days' + (s.n * 730.0 / :clients || ' days')::interval,
       pg_temp.anchor() - ((random() * 60)::int || ' days')::interval,
       CASE WHEN random() < 0.1 THEN pg_temp.anchor() - ((random() * 200)::int || ' days')::interval END,
       s.n % 100 = 0,
       CASE WHEN s.n % 100 = 0 THEN pg_temp.anchor() - interval '30 days' END
FROM syn_client_seed s
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN s.n % 12 = 0 THEN NULL                              -- no phone at all
         ELSE (ARRAY[
            pg_temp.syn_mobile(s.contact_n),
            '+91 ' || substr(pg_temp.syn_mobile(s.contact_n), 1, 5) || '-' || substr(pg_temp.syn_mobile(s.contact_n), 6),
            '0' || pg_temp.syn_mobile(s.contact_n),
            '91' || pg_temp.syn_mobile(s.contact_n),
            '0091 ' || pg_temp.syn_mobile(s.contact_n),
            pg_temp.syn_mobile(s.contact_n) || ' '
          ])[1 + ((s.n + s.contact_n) % 6)] END AS mobile,
    CASE WHEN s.n % 3 = 0 THEN NULL                                -- no e-mail
         WHEN s.n % 29 = 0 AND s.n > 500 THEN upper('person' || (s.n - 500) || '@example.invalid')   -- same e-mail, other case
         ELSE 'person' || s.n || '@example.invalid' END AS email,
    CASE WHEN s.n % 4 = 0 THEN 'ABCD' || chr(65 + (s.n / 10000) % 26) || lpad((s.n % 10000)::text, 4, '0') || 'F' END AS pan
) m;

-- merged-away duplicates (0.5%): point at an earlier client
UPDATE "Client" SET "mergedIntoId" = 'syn_cl_' || (substring(id from '_(\d+)$')::int - 7)
 WHERE substring(id from '_(\d+)$')::int % 200 = 5 AND substring(id from '_(\d+)$')::int > 7;

CREATE TEMP TABLE syn_cl AS SELECT row_number() OVER (ORDER BY id) AS i, id FROM "Client" WHERE NOT "isDeleted";
CREATE INDEX ON syn_cl(i);
SELECT count(*) AS cl_count FROM syn_cl \gset

-- lead intake (the original "leads"): 80k, with failures, duplicates and ragged raw payloads ----------------------------
INSERT INTO "LeadIntake" (id, source, "externalId", status, "clientId", "rawPayload", error, attempts, "receivedAt", "processedAt")
SELECT 'syn_li_' || g,
       (ARRAY['meta','web','google_ads','whatsapp','manual'])[1 + (g % 5)],
       'ext-' || g,
       st.s::"LeadIntakeStatus",
       CASE WHEN st.s IN ('CREATED','DUPLICATE') THEN (SELECT id FROM syn_cl WHERE i = 1 + (g % :cl_count)) END,
       jsonb_build_object('name', CASE WHEN g % 9 = 0 THEN NULL ELSE 'Lead ' || g END,
                          'phone', CASE WHEN g % 7 = 0 THEN NULL ELSE '+91 ' || pg_temp.syn_mobile(g % :clients) END,
                          'extra', CASE WHEN g % 5 = 0 THEN jsonb_build_object('form', 'f' || (g % 12), 'nested', jsonb_build_object('a', g % 3)) END),
       CASE WHEN st.s IN ('ERROR','REJECTED') THEN 'synthetic failure ' || (g % 5) END,
       1 + (g % 3),
       pg_temp.anchor() - interval '700 days' + (g * 700.0 / :leads || ' days')::interval,
       CASE WHEN st.s <> 'ERROR' THEN pg_temp.anchor() - interval '700 days' + (g * 700.0 / :leads || ' days')::interval + interval '3 seconds' END
FROM generate_series(1, :leads) g
CROSS JOIN LATERAL (SELECT CASE WHEN g % 20 = 0 THEN 'ERROR' WHEN g % 14 = 0 THEN 'REJECTED' WHEN g % 6 = 0 THEN 'DUPLICATE' ELSE 'CREATED' END AS s) st;

-- activities: 80k --------------------------------------------------------------------------------------------------------
INSERT INTO "Activity" (id, "clientId", "userId", type, payload, "createdAt")
SELECT 'syn_ac_' || g,
       (SELECT id FROM syn_cl WHERE i = r.ix),
       CASE WHEN random() < 0.8 THEN (SELECT id FROM syn_rm WHERE i = 1 + (g % :rm_count)) END,
       (ARRAY['NOTE','STATUS_CHANGE','STAGE_CHANGE','CALL','TICKET','MESSAGE','TASK_COMPLETED','JOURNEY_EVENT','MEETING','CONTACT'])[1 + (g % 10)]::"ActivityType",
       jsonb_build_object('message', CASE WHEN g % 17 = 0 THEN '' ELSE 'Synthetic activity ' || g END, 'durationSec', CASE WHEN g % 10 = 3 THEN (random()*600)::int END),
       pg_temp.anchor() - ((random() * 730)::int || ' days')::interval - ((random() * 86400)::int || ' seconds')::interval
FROM generate_series(1, :activities) g
CROSS JOIN LATERAL (SELECT 1 + floor(power(random(), 1.5) * :cl_count)::int AS ix OFFSET 0) r;

-- messages: 300k (WhatsApp mostly), skewed so a few clients have very long threads ------------------------------------------
INSERT INTO "Message" (id, "clientId", channel, provider, direction, body, status, "externalId", metadata, "createdAt", "accountId", "senderUserId", origin, "sentAt", "readAt", "mediaType", "mediaUrl")
SELECT 'syn_ms_' || g,
       (SELECT id FROM syn_cl WHERE i = r.ix),
       CASE WHEN g % 12 = 0 THEN 'sms' ELSE 'whatsapp' END,
       CASE WHEN g % 12 = 0 THEN 'exotel' ELSE 'openwa' END,
       CASE WHEN g % 3 = 0 THEN 'OUTBOUND' ELSE 'INBOUND' END::"MessageDirection",
       CASE g % 19
         WHEN 0 THEN ''
         WHEN 1 THEN 'नमस्ते, मुझे खाता खोलना है 🙏'
         WHEN 2 THEN repeat('long message ', 120)
         WHEN 3 THEN 'Hi, what is the status of my KYC?'
         WHEN 4 THEN 'Please call me back. Not interested now.'
         ELSE 'Synthetic message number ' || g END,
       (ARRAY['SENT','DELIVERED','READ','FAILED','QUEUED'])[1 + (g % 5)]::"MessageStatus",
       CASE WHEN g % 12 = 0 THEN NULL ELSE 'wamid.' || g END,
       CASE WHEN g % 7 = 0 THEN jsonb_build_object('raw', jsonb_build_object('type', 'text')) END,
       pg_temp.anchor() - interval '600 days' + (g * 600.0 / :messages || ' days')::interval,
       CASE WHEN g % 12 = 0 THEN NULL ELSE 'syn_wa_' || (1 + (g % 12)) END,
       CASE WHEN g % 3 = 0 AND g % 12 <> 0 THEN (SELECT id FROM syn_rm WHERE i = 1 + (g % 12)) END,
       CASE WHEN g % 12 = 0 THEN NULL WHEN g % 3 = 0 THEN 'crm' ELSE 'customer' END,
       CASE WHEN g % 12 <> 0 THEN pg_temp.anchor() - interval '600 days' + (g * 600.0 / :messages || ' days')::interval END,
       CASE WHEN g % 3 <> 0 AND g % 4 = 0 THEN pg_temp.anchor() - interval '10 days' END,
       CASE WHEN g % 50 = 0 THEN 'image' END,
       CASE WHEN g % 50 = 0 THEN 'https://example.invalid/media/' || g || '.jpg' END
FROM generate_series(1, :messages) g
CROSS JOIN LATERAL (SELECT 1 + floor(power(random(), 2.2) * :cl_count)::int AS ix OFFSET 0) r;

-- tasks, notifications, stage history, tickets, reviews, kyc, funding, audit -------------------------------------------------
INSERT INTO "Task" (id, "clientId", "assignedToId", title, "dueAt", status, category, "slaMinutes", source, "createdAt", "updatedAt")
SELECT 'syn_tk_' || g, (SELECT id FROM syn_cl WHERE i = 1 + (g * 7 % :cl_count)), (SELECT id FROM syn_rm WHERE i = 1 + (g % :rm_count)),
       'Follow up ' || g, pg_temp.anchor() + ((g % 90) - 60 || ' days')::interval,
       (ARRAY['PENDING','DONE','OVERDUE','CANCELLED'])[1 + (g % 4)]::"TaskStatus",
       (ARRAY['FOLLOW_UP','MEETING','FUNDING','OTHER'])[1 + (g % 4)]::"TaskCategory",
       CASE WHEN g % 3 = 0 THEN 240 END, CASE WHEN g % 5 = 0 THEN 'stage-engine' ELSE 'manual' END, pg_temp.anchor() - interval '100 days', pg_temp.anchor()
FROM generate_series(1, :clients * 3 / 2) g;

INSERT INTO "Notification" (id, "userId", type, payload, "readAt", "createdAt")
SELECT 'syn_nt_' || g, (SELECT id FROM syn_rm WHERE i = 1 + (g % :rm_count)),
       (ARRAY['new_assignment','task_overdue','inbound_message','stage_sla_breach','kyc_update'])[1 + (g % 5)],
       jsonb_build_object('clientId', 'syn_cl_' || (1 + g % :clients)), CASE WHEN g % 3 = 0 THEN pg_temp.anchor() END, pg_temp.anchor() - ((g % 300) || ' days')::interval
FROM generate_series(1, :clients) g;

INSERT INTO "StageHistory" (id, "clientId", "fromStageId", "toStageId", "changedById", "changedAt", reason, "slaMet", "durationHours")
SELECT 'syn_sh_' || g, 'syn_cl_' || (1 + g % :clients), CASE WHEN g % 4 = 0 THEN NULL ELSE 'syn_st_' || (1 + g % 5) END, 'syn_st_' || (1 + (g + 1) % 6),
       (SELECT id FROM syn_rm WHERE i = 1 + (g % :rm_count)), pg_temp.anchor() - ((g % 500) || ' days')::interval,
       CASE WHEN g % 6 = 0 THEN 'synthetic' END, CASE WHEN g % 3 = 0 THEN NULL ELSE g % 2 = 0 END, CASE WHEN g % 3 = 0 THEN NULL ELSE (g % 100)::float END
FROM generate_series(1, :clients * 3 / 2) g;

INSERT INTO "SupportTicket" (id, "clientId", provider, "externalId", subject, status, priority, channel, "ticketCreatedAt", "ticketUpdatedAt", "lastSyncedAt", "createdAt", "updatedAt")
SELECT 'syn_sp_' || g, 'syn_cl_' || (1 + g % :clients), 'freshdesk', 'fd-' || g, CASE WHEN g % 4 = 0 THEN NULL ELSE 'Query ' || g END,
       (ARRAY['Open','Pending','Resolved','Closed'])[1 + (g % 4)], CASE WHEN g % 3 = 0 THEN NULL ELSE 'High' END, 'email',
       pg_temp.anchor() - ((g % 400) || ' days')::interval, pg_temp.anchor() - ((g % 200) || ' days')::interval, pg_temp.anchor(), pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, :clients * 2 / 5) g;

INSERT INTO "ConversationReview" (id, "clientId", "sourceType", "assignedRmId", status, transcript, "sentimentLabel", "qualityScore", "createdAt", "updatedAt")
SELECT 'syn_cr_' || g, 'syn_cl_' || (1 + g % :clients), 'WHATSAPP_THREAD', (SELECT id FROM syn_rm WHERE i = 1 + (g % :rm_count)),
       (ARRAY['ANALYZED','PENDING_TRANSCRIPT','FAILED'])[1 + (g % 3)]::"ConversationReviewStatus", 'synthetic transcript ' || g,
       CASE WHEN g % 3 = 0 THEN 'negative' ELSE 'neutral' END, 40 + (g % 60), pg_temp.anchor() - ((g % 200) || ' days')::interval, pg_temp.anchor()
FROM generate_series(1, :clients / 7) g;

INSERT INTO "KycRecord" (id, "clientId", "referenceNumber", status, "submissionDate", "updatedAt")
SELECT 'syn_ky_' || g, 'syn_cl_' || g, CASE WHEN g % 3 = 0 THEN NULL ELSE 'KYC' || g END, (ARRAY['PENDING','APPROVED','REJECTED','ADDITIONAL_INFO_REQUIRED'])[1 + (g % 4)]::"KycStatus",
       CASE WHEN g % 2 = 0 THEN pg_temp.anchor() - ((g % 300) || ' days')::interval END, pg_temp.anchor()
FROM generate_series(1, :clients * 2 / 5) g;

INSERT INTO "FundingRecord" (id, "clientId", status, amount, "fundingDate", "fundingMethod", "bankAccountVerified", "bankAccountLast4", "updatedAt")
SELECT 'syn_fd_' || g, 'syn_cl_' || g, (ARRAY['PENDING','PARTIALLY_FUNDED','FULLY_FUNDED','NOT_PROCEEDING'])[1 + (g % 4)]::"FundingStatus",
       CASE WHEN g % 4 <> 0 THEN round((random()*2000000)::numeric, 0) END, CASE WHEN g % 4 = 2 THEN pg_temp.anchor() - interval '40 days' END, 'UPI', g % 2 = 0, lpad((g % 10000)::text, 4, '0'), pg_temp.anchor()
FROM generate_series(1, :clients / 4) g;

-- audit log (hash chain is filled by the BEFORE INSERT trigger, never by us)
INSERT INTO "AuditLog" (id, "userId", entity, "entityId", action, "oldValue", "newValue", reason, "timestamp")
SELECT 'syn_au_' || g, (SELECT id FROM syn_adm), 'Client', 'syn_cl_' || (1 + g % :clients),
       (ARRAY['stage_changed','document_verified','hold_started','reopened'])[1 + (g % 4)],
       jsonb_build_object('from', 'syn_st_1'), jsonb_build_object('to', 'syn_st_2'), CASE WHEN g % 5 = 0 THEN 'synthetic' END,
       pg_temp.anchor() - interval '600 days' + (g * 600.0 / (:clients) || ' days')::interval
FROM generate_series(1, :clients) g;

-- accounts, products, transactions ----------------------------------------------------------------------------------------------
INSERT INTO "Product" (id, "productCode", name, category, "isActive", "createdAt", "updatedAt")
SELECT 'syn_pr_' || g, 'PRD' || lpad(g::text, 4, '0'), 'Synthetic product ' || g,
       (ARRAY['EQUITY','MUTUAL_FUND','PMS','INSURANCE','BOND','FIXED_DEPOSIT','NPS','AIF','OTHER'])[1 + (g % 9)]::"ProductCategory", true, pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, 60) g;

-- partners and commission history ---------------------------------------------------------------------------------------------------
INSERT INTO "PartnerProfile" (id, "userId", "partnerCode", "partnerType", tier, "empanelmentStatus", "empanelmentDate", region, "arnCode", "createdAt", "updatedAt")
SELECT 'syn_pp_' || row_number() OVER (ORDER BY u.id), u.id, 'PTR-' || lpad(row_number() OVER (ORDER BY u.id)::text, 5, '0'),
       CASE u.role WHEN 'PARTNER' THEN 'PARTNER' WHEN 'AFFILIATE' THEN 'AFFILIATE' ELSE 'DISTRIBUTOR' END::"PartnerType",
       (ARRAY['BRONZE','SILVER','GOLD','PLATINUM'])[1 + (row_number() OVER (ORDER BY u.id) % 4)::int]::"PartnerTier",
       (ARRAY['ACTIVE','ACTIVE','ACTIVE','ONBOARDING','SUSPENDED','TERMINATED'])[1 + (row_number() OVER (ORDER BY u.id) % 6)::int]::"EmpanelmentStatus",
       pg_temp.anchor() - interval '500 days', CASE WHEN random() < 0.5 THEN 'West' END, CASE WHEN random() < 0.4 THEN 'ARN-' || (10000 + (random()*89999)::int) END, pg_temp.anchor(), pg_temp.anchor()
FROM "User" u WHERE u.role IN ('PARTNER','AFFILIATE','DISTRIBUTOR');
-- a partner hierarchy: distributors are parents of some partners
UPDATE "PartnerProfile" p SET "parentPartnerProfileId" = (SELECT id FROM "PartnerProfile" d WHERE d."partnerType" = 'DISTRIBUTOR' ORDER BY d.id LIMIT 1 OFFSET (substring(p.id from '_(\d+)$')::int % 20))
 WHERE p."partnerType" = 'PARTNER' AND substring(p.id from '_(\d+)$')::int % 3 = 0;

INSERT INTO "CommissionPlan" (id, code, name, "appliesToPartnerType", "isActive", "createdAt", "updatedAt")
VALUES ('syn_cp_1','PLAN-A','Plan A','PARTNER',true,pg_temp.anchor(),pg_temp.anchor()),('syn_cp_2','PLAN-B','Plan B','AFFILIATE',true,pg_temp.anchor(),pg_temp.anchor()),
       ('syn_cp_3','PLAN-C','Plan C','DISTRIBUTOR',true,pg_temp.anchor(),pg_temp.anchor()),('syn_cp_4','PLAN-G','Generic',NULL,true,pg_temp.anchor(),pg_temp.anchor()),
       ('syn_cp_5','PLAN-OLD','Retired plan',NULL,false,pg_temp.anchor(),pg_temp.anchor());
INSERT INTO "CommissionRule" (id, "commissionPlanId", "productCategory", "transactionType", "rateType", "percentRate", "flatRate", "validFrom", "createdById", "createdAt", "updatedAt")
SELECT 'syn_cu_' || g, 'syn_cp_' || (1 + g % 5), CASE WHEN g % 3 = 0 THEN NULL ELSE (ARRAY['EQUITY','MUTUAL_FUND','PMS','AIF'])[1 + g % 4]::"ProductCategory" END,
       NULL, (ARRAY['PERCENT_OF_GROSS','PERCENT_OF_NET','FLAT_PER_TRANSACTION'])[1 + g % 3]::"CommissionRateType",
       CASE WHEN g % 3 <> 2 THEN round((0.1 + (g % 10) * 0.1)::numeric, 2) END, CASE WHEN g % 3 = 2 THEN 25 END, pg_temp.anchor() - interval '600 days', (SELECT id FROM syn_adm), pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, 15) g;
INSERT INTO "PartnerCommissionAssignment" (id, "partnerProfileId", "commissionPlanId", "validFrom", "assignedById", "createdAt")
SELECT 'syn_pa_' || row_number() OVER (), p.id, 'syn_cp_' || (1 + (substring(p.id from '_(\d+)$')::int % 4)), pg_temp.anchor() - interval '450 days', (SELECT id FROM syn_adm), pg_temp.anchor()
FROM "PartnerProfile" p;

INSERT INTO "TradingAccount" (id, "accountNumber", "clientId", "accountType", status, segments, depository, "openedAt", "sourcingPartnerId", "sourceSystem", "externalRef", "createdAt", "updatedAt")
SELECT 'syn_ta_' || g, 'ACC' || lpad(g::text, 8, '0'), 'syn_cl_' || (1 + (g * 3 % :clients)),
       (ARRAY['EQUITY','COMMODITY','CURRENCY','MUTUAL_FUND','PMS','INSURANCE','NPS','OTHER'])[1 + g % 8]::"TradingAccountType",
       (ARRAY['ACTIVE','ACTIVE','ACTIVE','DORMANT','CLOSED','SUSPENDED'])[1 + g % 6]::"TradingAccountStatus", ARRAY['CASH'],
       CASE WHEN g % 4 = 0 THEN NULL WHEN g % 2 = 0 THEN 'NSDL' ELSE 'CDSL' END::"Depository",
       pg_temp.anchor() - ((g % 600) || ' days')::interval,
       CASE WHEN g % 2 = 0 THEN 'syn_pp_' || (1 + g % 120) END, 'backoffice', 'acc-' || g, pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, :clients * 3 / 5) g;

INSERT INTO "Transaction" (id, "tradingAccountId", "productId", "transactionType", "transactionDate", "grossAmount", "netAmount", "brokerageAmount", "sourceSystem", "externalRef", "createdAt", "updatedAt")
SELECT 'syn_tx_' || g, 'syn_ta_' || (1 + g % (:clients * 3 / 5)), CASE WHEN g % 9 = 0 THEN NULL ELSE 'syn_pr_' || (1 + g % 60) END,
       (ARRAY['BUY','SELL','SIP','REDEMPTION','DIVIDEND','SWITCH_IN','SWITCH_OUT','CHARGES','OTHER'])[1 + g % 9]::"TransactionType",
       pg_temp.anchor() - ((g % 540) || ' days')::interval, round((1000 + random() * 500000)::numeric, 2), CASE WHEN g % 5 = 0 THEN NULL ELSE round((900 + random() * 400000)::numeric, 2) END,
       round((random() * 400)::numeric, 2), 'backoffice', 'tx-' || g, pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, :clients * 5 / 2) g;

INSERT INTO "RevenueEvent" (id, "sourceSystem", "externalRef", "transactionId", "tradingAccountId", "clientId", "revenueType", "grossRevenueAmount", "eventDate", "ingestedAt", "rawPayload")
SELECT 'syn_re_' || g, 'backoffice', 'rev-' || g, 'syn_tx_' || g, t."tradingAccountId", a."clientId",
       (ARRAY['BROKERAGE','TRAIL_COMMISSION','UPFRONT_COMMISSION','AMC_PAYOUT','ADVISORY_FEE','OTHER'])[1 + g % 6]::"RevenueType",
       round((50 + random() * 5000)::numeric, 2), t."transactionDate", pg_temp.anchor(), jsonb_build_object('src', 'synthetic')
FROM generate_series(1, :clients * 2) g
JOIN "Transaction" t ON t.id = 'syn_tx_' || g JOIN "TradingAccount" a ON a.id = t."tradingAccountId";

-- accruals: two partners per event for about half of them; commission history over 18 months
INSERT INTO "CommissionAccrual" (id, "revenueEventId", "partnerProfileId", "commissionRuleId", "accrualAmount", "accrualDate", status, "computationVersion", "computedAt")
SELECT 'syn_ca_' || row_number() OVER (), e.id, 'syn_pp_' || (1 + (substring(e.id from '_(\d+)$')::int + k) % 120), 'syn_cu_' || (1 + (substring(e.id from '_(\d+)$')::int + k) % 15),
       round((e."grossRevenueAmount" * 0.3)::numeric, 2), e."eventDate",
       (ARRAY['ACCRUED','ACCRUED','ADJUSTED','REVERSED','INCLUDED_IN_PAYOUT'])[1 + (substring(e.id from '_(\d+)$')::int % 5)]::"AccrualStatus", 'v1', pg_temp.anchor()
FROM "RevenueEvent" e CROSS JOIN generate_series(0, 1) k
WHERE k = 0 OR substring(e.id from '_(\d+)$')::int % 2 = 0;

INSERT INTO "PayoutRun" (id, "periodStart", "periodEnd", status, "createdById", "approvedById", "approvedAt", "finalizedAt", "createdAt")
SELECT 'syn_pr_run_' || m, date_trunc('month', pg_temp.anchor()) - (m || ' months')::interval, date_trunc('month', pg_temp.anchor()) - ((m - 1) || ' months')::interval - interval '1 day',
       CASE WHEN m = 1 THEN 'PENDING_APPROVAL' ELSE 'FINALIZED' END::"PayoutRunStatus", (SELECT id FROM syn_adm), CASE WHEN m > 1 THEN (SELECT id FROM syn_adm) END,
       CASE WHEN m > 1 THEN pg_temp.anchor() END, CASE WHEN m > 1 THEN pg_temp.anchor() END, pg_temp.anchor()
FROM generate_series(1, 12) m;
INSERT INTO "Payout" (id, "payoutRunId", "partnerProfileId", "totalAccrualAmount", "adjustmentAmount", "netPayableAmount", status)
SELECT 'syn_po_' || row_number() OVER (), r.id, p.id, round((100 + random() * 20000)::numeric, 2), CASE WHEN random() < 0.1 THEN -250 ELSE 0 END, round((100 + random() * 20000)::numeric, 2), 'ESTIMATED'
FROM "PayoutRun" r CROSS JOIN "PartnerProfile" p WHERE substring(p.id from '_(\d+)$')::int % 2 = substring(r.id from '(\d+)$')::int % 2;
INSERT INTO "PayoutLine" (id, "payoutId", "commissionAccrualId", amount)
SELECT 'syn_pl_' || row_number() OVER (), po.id, a.id, a."accrualAmount"
FROM (SELECT id, "partnerProfileId", row_number() OVER (PARTITION BY "partnerProfileId" ORDER BY id) AS rn FROM "Payout") po
JOIN (SELECT id, "partnerProfileId", "accrualAmount", row_number() OVER (PARTITION BY "partnerProfileId" ORDER BY id) AS rn FROM "CommissionAccrual" WHERE status = 'INCLUDED_IN_PAYOUT') a
  ON a."partnerProfileId" = po."partnerProfileId" AND a.rn = po.rn;
INSERT INTO "CommissionAdjustment" (id, "partnerProfileId", amount, reason, "createdById", "createdAt")
SELECT 'syn_cj_' || g, 'syn_pp_' || (1 + g % 120), CASE WHEN g % 3 = 0 THEN -500 ELSE 300 END, 'synthetic adjustment', (SELECT id FROM syn_adm), pg_temp.anchor() - ((g % 300) || ' days')::interval
FROM generate_series(1, 200) g;

INSERT INTO "ClientPayment" (id, "clientId", "paymentType", amount, "paidAt", mode, status, "sourceSystem", "externalRef", "createdAt", "updatedAt")
SELECT 'syn_cm_' || g, 'syn_cl_' || (1 + g % :clients), (ARRAY['FUNDS_IN','FUNDS_OUT','FEE','OTHER'])[1 + g % 4]::"PaymentType", round((500 + random()*900000)::numeric, 2),
       pg_temp.anchor() - ((g % 500) || ' days')::interval, (ARRAY['UPI','NEFT','RTGS','IMPS','CHEQUE'])[1 + g % 5], 'SUCCESS', 'backoffice', 'pay-' || g, pg_temp.anchor(), pg_temp.anchor()
FROM generate_series(1, :clients / 2) g;

ANALYZE;
