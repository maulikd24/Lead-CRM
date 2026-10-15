"use client";

import Link from "next/link";
import { useActionState } from "react";

import { loginAction, ssoLoginAction, type LoginState } from "@/app/login/actions";

import { AllvestLogo } from "./allvest-logo";
import { GoogleButton } from "./google-button";
import { ThemeScript } from "./theme-script";
import { ThemeToggle } from "./theme-toggle";

import "./front-door.css";

const initialState: LoginState = {};

export type LoginNotice = { tone: "calm" | "plain"; title: string; body: string };

export type LoginPanelProps = {
  googleAvailable: boolean;
  /** Keycloak single sign-on (the "SSO later" seam: more providers slot in beside Google). */
  ssoAvailable: boolean;
  showCredentials: boolean;
  notice?: LoginNotice;
  callbackUrl?: string;
};

/** The redesigned sign-in page. Company Google first when it is on; the email and password form is the smaller fallback. */
export function LoginPanel({ googleAvailable, ssoAvailable, showCredentials, notice, callbackUrl }: LoginPanelProps) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const federated = googleAvailable || ssoAvailable;

  return (
    <div className="fd">
      <ThemeScript />
      <a href="#login-main" className="fd-skip">Skip to sign in</a>
      <div className="fd-login">
        <div className="fd-login-tools"><ThemeToggle /></div>
        <Link href="/" className="fd-back">
          <span aria-hidden="true">&larr; </span>Back to Allvest Customer OS
        </Link>
        <main id="login-main" className="fd-login-card">
          <AllvestLogo animate tagline title="Allvest" className="fd-login-logo" />
          <h1>Sign in to Customer OS</h1>
          <p className="fd-lede">
            {googleAvailable ? "Use your company Google account. An administrator sets up your access." : "Use your email and password. An administrator sets up your access."}
          </p>

          {notice && (
            <div role="alert" className="fd-notice" data-tone={notice.tone} style={{ marginTop: 24 }}>
              <strong>{notice.title}</strong>
              {notice.body}
            </div>
          )}

          <div className="fd-panel">
            {googleAvailable && <GoogleButton callbackUrl={callbackUrl} />}
            {ssoAvailable && (
              <form action={ssoLoginAction}>
                {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
                <button type="submit" className="fd-btn fd-btn-ghost">Sign in with SSO</button>
              </form>
            )}

            {federated && showCredentials && <div className="fd-divider" aria-hidden="true">or use email and password</div>}

            {showCredentials && (
              <form action={formAction} className="grid gap-4" noValidate={false}>
                <div className="fd-field">
                  <label htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" autoComplete="email" required className="fd-input" aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "login-error" : undefined} />
                </div>
                <div className="fd-field">
                  <label htmlFor="password">Password</label>
                  <input id="password" name="password" type="password" autoComplete="current-password" required className="fd-input" aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "login-error" : undefined} />
                </div>
                <p id="login-error" role="alert" className="fd-error" hidden={!state.error}>
                  {state.error}
                </p>
                <button type="submit" disabled={pending} aria-busy={pending} className={federated ? "fd-btn fd-btn-ghost" : "fd-btn fd-btn-primary"}>
                  {pending ? "Signing in..." : "Sign in"}
                </button>
              </form>
            )}
          </div>
          <p className="fd-fine" style={{ marginTop: 20 }}>No account yet? Ask an administrator to add you.</p>
        </main>
      </div>
    </div>
  );
}
