-- Tamper-evident, append-only AuditLog (SEBI record-keeping).
--
-- 1. Append-only: UPDATE, DELETE and TRUNCATE on "AuditLog" are rejected by triggers, for every role
--    including the app's own connection.
-- 2. Hash chain: every row stores a gapless sequence number, the previous row's hash and its own
--    SHA-256 hash over its content + prevHash. Editing, deleting or reordering any row (e.g. by an
--    owner who disables the triggers) breaks the chain from that point on, and audit_log_verify()
--    reports it.
-- 3. "AuditLogChainHead" holds the latest seq/hash. Updating it takes a row lock, which serialises
--    concurrent audit inserts so the chain never forks; a rolled-back insert rolls the head back too.
--
-- Everything happens in the database, so the 25 existing prisma.auditLog.create() call sites need no
-- changes and no future writer can skip it.

-- Chain head (single row) ----------------------------------------------------------------------------
CREATE TABLE "AuditLogChainHead" (
    "id"   INTEGER NOT NULL DEFAULT 1,
    "seq"  BIGINT  NOT NULL DEFAULT 0,
    "hash" TEXT    NOT NULL DEFAULT '',
    CONSTRAINT "AuditLogChainHead_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLogChainHead_single_row" CHECK ("id" = 1)
);

-- New columns (DB defaults are placeholders: the BEFORE INSERT trigger always overwrites them) -----
ALTER TABLE "AuditLog" ADD COLUMN "seq"      BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT   NOT NULL DEFAULT '';
ALTER TABLE "AuditLog" ADD COLUMN "hash"     TEXT   NOT NULL DEFAULT '';

-- Canonical row hash. jsonb's text form is deterministic (fixed key order, ISO timestamps), so the
-- same expression recomputes the same hash in audit_log_verify() or any external verifier.
CREATE FUNCTION audit_log_row_hash(
    p_seq BIGINT, p_id TEXT, p_user_id TEXT, p_entity TEXT, p_entity_id TEXT, p_action TEXT,
    p_old JSONB, p_new JSONB, p_reason TEXT, p_ts TIMESTAMP(3), p_prev_hash TEXT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(
        jsonb_build_array(p_seq, p_id, p_user_id, p_entity, p_entity_id, p_action,
                          p_old, p_new, p_reason, p_ts, p_prev_hash)::text,
        'UTF8')), 'hex')
$$;

-- Backfill existing rows in chronological order --------------------------------------------------
DO $$
DECLARE
    r      RECORD;
    v_seq  BIGINT := 0;
    v_prev TEXT   := '';
    v_hash TEXT;
BEGIN
    FOR r IN SELECT * FROM "AuditLog" ORDER BY "timestamp", "id" LOOP
        v_seq  := v_seq + 1;
        v_hash := audit_log_row_hash(v_seq, r."id", r."userId", r."entity", r."entityId", r."action",
                                     r."oldValue", r."newValue", r."reason", r."timestamp", v_prev);
        UPDATE "AuditLog" SET "seq" = v_seq, "prevHash" = v_prev, "hash" = v_hash WHERE "id" = r."id";
        v_prev := v_hash;
    END LOOP;
    INSERT INTO "AuditLogChainHead" ("id", "seq", "hash") VALUES (1, v_seq, v_prev);
END $$;

CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- Chain each new row on insert --------------------------------------------------------------------
CREATE FUNCTION audit_log_chain_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_seq  BIGINT;
    v_prev TEXT;
BEGIN
    -- Row lock on the head serialises concurrent inserts until this transaction ends.
    UPDATE "AuditLogChainHead" SET "seq" = "seq" + 1 WHERE "id" = 1
        RETURNING "seq", "hash" INTO v_seq, v_prev;
    IF v_seq IS NULL THEN
        RAISE EXCEPTION 'AuditLogChainHead row is missing';
    END IF;

    NEW."seq"      := v_seq;
    NEW."prevHash" := v_prev;
    NEW."hash"     := audit_log_row_hash(v_seq, NEW."id", NEW."userId", NEW."entity", NEW."entityId",
                                         NEW."action", NEW."oldValue", NEW."newValue", NEW."reason",
                                         NEW."timestamp", v_prev);

    UPDATE "AuditLogChainHead" SET "hash" = NEW."hash" WHERE "id" = 1;
    RETURN NEW;
END $$;

CREATE TRIGGER "AuditLog_chain_insert"
    BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION audit_log_chain_insert();

-- Reject every mutation ---------------------------------------------------------------------------
CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "AuditLog_no_update_delete"
    BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER "AuditLog_no_truncate"
    BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();

-- The head may only move forward through audit_log_chain_insert(); block deleting/truncating it.
CREATE TRIGGER "AuditLogChainHead_no_delete"
    BEFORE DELETE ON "AuditLogChainHead"
    FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER "AuditLogChainHead_no_truncate"
    BEFORE TRUNCATE ON "AuditLogChainHead"
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();

-- Verification ------------------------------------------------------------------------------------
-- Walks the chain and returns one row per problem (empty result = intact). Problems:
--   seq_gap        a row is missing (deleted) between two seq numbers
--   prev_mismatch  prevHash doesn't equal the previous row's hash (row removed/reordered)
--   hash_mismatch  the row's content no longer matches its hash (row edited)
--   head_mismatch  the chain head doesn't point at the last row (tail rows removed)
CREATE FUNCTION audit_log_verify()
RETURNS TABLE ("seq" BIGINT, "id" TEXT, "problem" TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r          RECORD;
    v_prev_seq BIGINT := 0;
    v_prev     TEXT   := '';
    h          RECORD;
BEGIN
    FOR r IN SELECT * FROM "AuditLog" a ORDER BY a."seq" LOOP
        IF r."seq" <> v_prev_seq + 1 THEN
            seq := r."seq"; id := r."id"; problem := 'seq_gap'; RETURN NEXT;
        END IF;
        IF r."prevHash" <> v_prev THEN
            seq := r."seq"; id := r."id"; problem := 'prev_mismatch'; RETURN NEXT;
        END IF;
        IF r."hash" <> audit_log_row_hash(r."seq", r."id", r."userId", r."entity", r."entityId",
                                          r."action", r."oldValue", r."newValue", r."reason",
                                          r."timestamp", r."prevHash") THEN
            seq := r."seq"; id := r."id"; problem := 'hash_mismatch'; RETURN NEXT;
        END IF;
        v_prev_seq := r."seq";
        v_prev     := r."hash";
    END LOOP;

    SELECT * INTO h FROM "AuditLogChainHead" WHERE "AuditLogChainHead"."id" = 1;
    IF h IS NULL OR h."seq" <> v_prev_seq OR h."hash" <> v_prev THEN
        seq := v_prev_seq; id := NULL; problem := 'head_mismatch'; RETURN NEXT;
    END IF;
END $$;
