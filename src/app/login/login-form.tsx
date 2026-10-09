"use client";

import { useActionState } from "react";

import { loginAction, ssoLoginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Logo } from "@/components/logo";

const initialState: LoginState = {};

export type LoginFormProps = {
  /** SSO is enabled and fully configured on the server. */
  ssoAvailable: boolean;
  /** Show the email/password form (false when SSO_ONLY hides it). */
  showCredentials: boolean;
  /** Generic, pre-worded message for a failed SSO attempt (never says why). */
  notice?: string;
  callbackUrl?: string;
};

export function LoginForm({ ssoAvailable, showCredentials, notice, callbackUrl }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Logo className="size-8" />
            <span className="font-heading text-lg font-semibold tracking-tight">Supportify</span>
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Access your Supportify dashboard</p>

          {notice && (
            <p role="alert" className="mt-6 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              {notice}
            </p>
          )}

          {ssoAvailable && (
            <form action={ssoLoginAction} className="mt-8">
              {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
              <Button type="submit" className="w-full">
                Sign in with SSO
              </Button>
            </form>
          )}

          {ssoAvailable && showCredentials && (
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          )}

          {showCredentials && (
            <form action={formAction} className={ssoAvailable ? undefined : "mt-8"}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" name="email" type="email" autoComplete="email" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="current-password" required />
                </Field>
                {state.error && <FieldError>{state.error}</FieldError>}
                <Button type="submit" variant={ssoAvailable ? "outline" : "default"} disabled={pending} className="w-full">
                  {pending ? "Signing in..." : "Sign in"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
