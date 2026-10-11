"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

export type FormField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "lines" | "select" | "number" | "date" | "checkbox";
  options?: { value: string; label: string }[];
  help?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
};

export type ActionOutcome = { ok: true; id?: string; message?: string } | { ok: false; error: string };

const control = "native-control h-9 w-full min-w-0";

/**
 * One generic form for every planner editor: fields as data, one server action. Values are plain strings (a "lines" field is one item per line, a
 * checkbox is a boolean); the server validates everything again. Shows the server's own words on error, and a polite status on success.
 */
export function ActionForm({ fields, initial, action, submitLabel = "Save", label, redirectTo, resetOnSuccess = false }: { fields: FormField[]; initial?: Record<string, unknown>; action: (values: Record<string, unknown>) => Promise<ActionOutcome>; submitLabel?: string; label: string; redirectTo?: string; resetOnSuccess?: boolean }) {
  const router = useRouter();
  const uid = useId();
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? initial?.[f.name] === true : Array.isArray(initial?.[f.name]) ? (initial?.[f.name] as string[]).join("\n") : String(initial?.[f.name] ?? "")]));
  const [values, setValues] = useState<Record<string, unknown>>(blank);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (name: string, v: unknown) => setValues((cur) => ({ ...cur, [name]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await action(values);
      if (!r.ok) return setMessage({ tone: "error", text: r.error });
      setMessage({ tone: "ok", text: r.message ?? "Saved." });
      if (resetOnSuccess) setValues(blank());
      if (redirectTo) router.push(redirectTo.replace("{id}", r.id ?? ""));
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} aria-label={label} className="grid max-w-2xl gap-3">
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const helpId = f.help ? `${id}-help` : undefined;
        const common = { id, name: f.name, "aria-describedby": helpId, required: f.required } as const;
        if (f.type === "checkbox") {
          return (
            <div key={f.name} className="flex items-start gap-2 text-sm">
              <input {...common} type="checkbox" className="mt-1 size-4" checked={values[f.name] === true} onChange={(e) => set(f.name, e.target.checked)} />
              <label htmlFor={id} className="grid gap-0.5"><span className="font-medium">{f.label}</span>{f.help && <span id={helpId} className="text-xs text-muted-foreground">{f.help}</span>}</label>
            </div>
          );
        }
        return (
          <div key={f.name} className="grid gap-1 text-sm">
            <label htmlFor={id} className="font-medium">{f.label}{f.required ? <span aria-hidden className="text-destructive"> *</span> : null}</label>
            {f.type === "textarea" || f.type === "lines" ? (
              <textarea {...common} className="native-control min-h-20 w-full min-w-0 py-2" rows={f.type === "lines" ? 4 : 3} maxLength={f.maxLength} placeholder={f.placeholder} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            ) : f.type === "select" ? (
              <select {...common} className={control} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)}>
                {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input {...common} className={control} type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "numeric" : undefined} maxLength={f.maxLength} placeholder={f.placeholder} value={String(values[f.name] ?? "")} onChange={(e) => set(f.name, e.target.value)} />
            )}
            {f.help && <span id={helpId} className="text-xs text-muted-foreground">{f.help}</span>}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : submitLabel}</Button>
        {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-success"}>{message.text}</p>}
      </div>
    </form>
  );
}
