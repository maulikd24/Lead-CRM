// Typed access to @capacitor/push-notifications as injected into the Android app's WebView
// (window.Capacitor.Plugins.PushNotifications). Not bundled — the site loads remotely inside the shell.

export interface PushPluginListenerHandle {
  remove(): Promise<void>;
}

export interface PushNotificationsPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  createChannel(channel: { id: string; name: string; description?: string; importance: number; visibility?: number }): Promise<void>;
  addListener(event: "registration", cb: (token: { value: string }) => void): Promise<PushPluginListenerHandle>;
  addListener(event: "registrationError", cb: (error: unknown) => void): Promise<PushPluginListenerHandle>;
  addListener(
    event: "pushNotificationReceived",
    cb: (n: { title?: string; body?: string; data?: Record<string, string> }) => void,
  ): Promise<PushPluginListenerHandle>;
  addListener(
    event: "pushNotificationActionPerformed",
    cb: (a: { notification: { data?: Record<string, string> } }) => void,
  ): Promise<PushPluginListenerHandle>;
}

type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { PushNotifications?: PushNotificationsPlugin } };

export function getPushPlugin(): PushNotificationsPlugin | null {
  if (typeof window === "undefined") return null;
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!capacitor?.isNativePlatform?.()) return null;
  return capacitor.Plugins?.PushNotifications ?? null;
}

export const PUSH_TOKEN_STORAGE_KEY = "supportify:fcmToken";
