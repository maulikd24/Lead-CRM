"use client";

import { useFormStatus } from "react-dom";

import { googleLoginAction } from "@/app/login/actions";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function Inner({ className }: { className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? null : <GoogleMark />}
      <span>{pending ? "Opening Google..." : "Continue with Google"}</span>
    </button>
  );
}

/** "Continue with Google": a plain form posting to the server action, so it works without client JS and shows a loading state with it. */
export function GoogleButton({ callbackUrl, variant = "google" }: { callbackUrl?: string; variant?: "google" | "primary" }) {
  return (
    <form action={googleLoginAction}>
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
      <Inner className={variant === "primary" ? "fd-btn fd-btn-primary" : "fd-btn fd-btn-google"} />
    </form>
  );
}
