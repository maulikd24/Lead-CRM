"use client";

import { useActionState } from "react";

import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Logo } from "@/components/logo";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex min-h-screen">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Logo className="size-8" />
            <span className="font-heading text-lg font-semibold tracking-tight">Supportify</span>
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Access your Supportify dashboard</p>

          <form action={formAction} className="mt-8">
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
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Signing in..." : "Sign in"}
              </Button>
            </FieldGroup>
          </form>
        </div>
      </div>

      <div className="relative hidden flex-1 flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-heading text-lg font-semibold tracking-tight">Supportify</span>
        </div>
        <div className="max-w-md">
          <p className="font-heading text-2xl font-semibold tracking-tight">
            Client onboarding, streamlined end to end.
          </p>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Track every lead from first contact through KYC, funding, and dealer handoff — with
            SLA automation and manager visibility built in.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Allvest Securities Private Limited</p>
      </div>
    </div>
  );
}
