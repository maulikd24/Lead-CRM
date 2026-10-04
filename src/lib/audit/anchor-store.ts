import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";

/** One day's record of the AuditLog chain tip, stored outside the database. If someone with DB owner rights
 * rewrites history and recomputes every hash, the chain still verifies — but the row at `seq` no longer
 * carries the `hash` recorded here. */
export type AuditAnchor = {
  version: 1;
  date: string; // IST calendar date, "yyyy-MM-dd" — also the object key
  seq: string; // bigint as string
  hash: string;
  database: string;
  chainProblems: number; // what audit_log_verify() reported when this anchor was taken
  anchorProblems: number | null; // earlier anchors that no longer matched at the time (null = not checked this run)
  createdAt: string;
};

export interface AnchorStore {
  /** Writes the anchor for `anchor.date`. Returns "exists" (and changes nothing) if that day is already anchored. */
  put(anchor: AuditAnchor): Promise<"written" | "exists">;
  /** Anchors dated after `afterDate` ("yyyy-MM-dd"), oldest first. */
  listSince(afterDate: string): Promise<AuditAnchor[]>;
}

// Configured from env, never from the database: a DB owner able to rewrite AuditLog must not also be able
// to redirect or switch off the copy that would expose it.
export type AnchorConfig = {
  bucket: string;
  region: string;
  prefix: string;
  lockMode: "COMPLIANCE" | "GOVERNANCE";
  retentionDays: number;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

export function anchorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnchorConfig | null {
  const bucket = env.AUDIT_ANCHOR_S3_BUCKET;
  const region = env.AUDIT_ANCHOR_S3_REGION;
  if (!bucket || !region) return null;
  const lockMode = env.AUDIT_ANCHOR_LOCK_MODE === "GOVERNANCE" ? "GOVERNANCE" : "COMPLIANCE";
  const retentionDays = Number(env.AUDIT_ANCHOR_RETENTION_DAYS ?? 2920); // default 8 years
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("AUDIT_ANCHOR_RETENTION_DAYS must be a positive integer");
  const accessKeyId = env.AUDIT_ANCHOR_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AUDIT_ANCHOR_AWS_SECRET_ACCESS_KEY;
  return {
    bucket,
    region,
    // Per-environment by default so a Preview deployment's anchors can never be checked against Production's DB.
    prefix: env.AUDIT_ANCHOR_S3_PREFIX ?? `audit-anchors/${env.VERCEL_ENV ?? "local"}/`,
    lockMode,
    retentionDays,
    // Dedicated keys so this write-only identity isn't shared with anything else; falls back to the SDK's default chain.
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  };
}

export class S3AnchorStore implements AnchorStore {
  constructor(
    private readonly config: AnchorConfig,
    private readonly client = new S3Client({ region: config.region, credentials: config.credentials }),
  ) {}

  private key(date: string) {
    return `${this.config.prefix}${date}.json`;
  }

  async put(anchor: AuditAnchor): Promise<"written" | "exists"> {
    const retainUntil = new Date(Date.now() + this.config.retentionDays * 86_400_000);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: this.key(anchor.date),
          Body: JSON.stringify(anchor),
          ContentType: "application/json",
          IfNoneMatch: "*", // never replace an existing day's anchor
          ChecksumAlgorithm: "SHA256", // Object Lock puts require an integrity checksum
          ObjectLockMode: this.config.lockMode,
          ObjectLockRetainUntilDate: retainUntil,
        }),
      );
      return "written";
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) return "exists";
      throw error;
    }
  }

  async listSince(afterDate: string): Promise<AuditAnchor[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: this.config.prefix, StartAfter: this.key(afterDate), ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) if (object.Key?.endsWith(".json")) keys.push(object.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    keys.sort(); // yyyy-MM-dd keys sort chronologically
    return Promise.all(
      keys.map(async (Key) => {
        const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key }));
        return JSON.parse(await object.Body!.transformToString()) as AuditAnchor;
      }),
    );
  }
}
