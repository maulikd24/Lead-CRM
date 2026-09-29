import { isAccountOnline } from "./send";
import type { WhatsAppAccount, WhatsAppAccountStatus } from "@/generated/prisma/client";

const QR_FRESH_MS = 90_000;

export type AccountState = {
  id: string;
  label: string;
  sessionId: string;
  status: WhatsAppAccountStatus;
  phoneNumber: string | null;
  online: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  /** Only present while a scannable, fresh QR exists — a stale QR is worse than none. */
  qr: string | null;
  /** True when a QR was produced but is now >90s old — distinct from "never produced one yet". */
  qrExpired: boolean;
  /** When the last QR (fresh or stale) was received, for showing "expired Ns ago" in the UI. */
  qrUpdatedAt: string | null;
};

export function toAccountState(account: WhatsAppAccount): AccountState {
  const hasQr = account.status === "QR_PENDING" && account.qrDataUrl !== null && account.qrUpdatedAt !== null;
  const qrFresh = hasQr && Date.now() - account.qrUpdatedAt!.getTime() < QR_FRESH_MS;

  return {
    id: account.id,
    label: account.label,
    sessionId: account.sessionId,
    status: account.status,
    phoneNumber: account.phoneNumber,
    online: isAccountOnline(account),
    lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
    lastError: account.lastError,
    qr: qrFresh ? account.qrDataUrl : null,
    qrExpired: hasQr && !qrFresh,
    qrUpdatedAt: hasQr ? account.qrUpdatedAt!.toISOString() : null,
  };
}
