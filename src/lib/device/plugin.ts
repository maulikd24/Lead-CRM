// Thin typed access to the native CallLogSync Capacitor plugin. The site is loaded remotely inside the
// Android app's WebView, which injects window.Capacitor — we deliberately don't bundle @capacitor/core.

export type CallSyncStatus = {
  hasToken: boolean;
  hasPermission: boolean;
  deviceId: string | null;
  lastSyncAt: number | null;
  appVersion: string;
};

export interface CallLogSyncPlugin {
  status(): Promise<CallSyncStatus>;
  requestPermission(): Promise<{ granted: boolean }>;
  openAppSettings(): Promise<void>;
  configure(options: { token: string; deviceId: string; baseUrl: string }): Promise<void>;
  schedulePeriodic(): Promise<void>;
  syncNow(): Promise<{ matched?: number; ok: boolean }>;
  disconnect(): Promise<void>;
}

type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { CallLogSync?: CallLogSyncPlugin } };

export function getCallLogPlugin(): CallLogSyncPlugin | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.CallLogSync ?? null;
}
