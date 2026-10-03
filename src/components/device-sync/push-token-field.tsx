"use client";

import { useEffect, useRef } from "react";

import { PUSH_TOKEN_STORAGE_KEY } from "@/lib/device/push-plugin";

/**
 * Placed inside the sign-out form: when the form is submitted it adds this phone's push token, so logout can
 * unregister it. Read at submit time (the `formdata` event) rather than on mount — the token is written to
 * localStorage asynchronously after the Android app registers, which can be after the sidebar first renders.
 */
export function PushTokenField() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const onFormData = (event: FormDataEvent) => {
      try {
        const token = localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
        if (token) event.formData.set("pushToken", token);
      } catch {}
    };
    form.addEventListener("formdata", onFormData);
    return () => form.removeEventListener("formdata", onFormData);
  }, []);

  return <span ref={anchor} hidden />;
}
