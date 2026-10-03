"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { registerPushTokenAction } from "@/app/(dashboard)/settings/account/push-actions";
import { getPushPlugin, PUSH_TOKEN_STORAGE_KEY, type PushPluginListenerHandle } from "@/lib/device/push-plugin";

/**
 * Mounted once in the dashboard layout for every role. Inside the Android app only: asks for the notification
 * permission, registers this phone with Firebase, tells the server the token (re-sent on every app open and
 * whenever Firebase rotates it), shows alerts that arrive while the app is open, and opens the right page
 * when one is tapped. Renders nothing; a normal browser does nothing.
 */
export function PushSetup() {
  const router = useRouter();

  useEffect(() => {
    const plugin = getPushPlugin();
    if (!plugin) return;

    const handles: PushPluginListenerHandle[] = [];
    let cancelled = false;

    (async () => {
      try {
        const add = async (h: Promise<PushPluginListenerHandle>) => {
          const handle = await h;
          if (cancelled) void handle.remove();
          else handles.push(handle);
        };

        await add(
          plugin.addListener("registration", (token) => {
            try {
              localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token.value);
            } catch {}
            registerPushTokenAction(token.value).catch(() => {});
          }),
        );
        await add(plugin.addListener("registrationError", (error) => console.warn("Push registration failed", error)));
        await add(
          plugin.addListener("pushNotificationReceived", (n) => {
            toast(n.title ?? "Supportify", { description: n.body });
          }),
        );
        await add(
          plugin.addListener("pushNotificationActionPerformed", (action) => {
            const url = action.notification.data?.url;
            if (url && url.startsWith("/")) router.push(url);
          }),
        );

        let permission = (await plugin.checkPermissions()).receive;
        if (permission === "prompt" || permission === "prompt-with-rationale") permission = (await plugin.requestPermissions()).receive;
        if (permission !== "granted") return;

        await plugin.createChannel({ id: "alerts", name: "Alerts", description: "SLA, task and lead alerts", importance: 4 });
        await plugin.register();
      } catch (error) {
        console.warn("Push setup failed", error);
      }
    })();

    return () => {
      cancelled = true;
      handles.forEach((h) => void h.remove());
    };
  }, [router]);

  return null;
}
