import { Play, ThumbsUp } from "lucide-react";

import type { FieldValues, FormatKey } from "@/lib/creative/formats";
import { cn } from "@/lib/utils";

/**
 * Approximate previews of how a variant will look on each channel, built from the copy as typed. They help a reviewer see
 * length, line breaks and the call to action in place; the platform may crop, truncate or reflow differently, and the picture
 * itself is a neutral placeholder. Theme tokens only, no brand marks of any platform.
 */

const first = (f: FieldValues, k: string) => (f[k] ?? []).find((v) => v.trim())?.trim() ?? "";
const all = (f: FieldValues, k: string) => (f[k] ?? []).map((v) => v.trim()).filter(Boolean);

function Placeholder({ ratio, className }: { ratio: string; className?: string }) {
  return (
    <div aria-hidden className={cn("flex w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/50 text-[11px] text-muted-foreground", className)} style={{ aspectRatio: ratio }}>
      Creative goes here
    </div>
  );
}

function Profile({ line }: { line: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">A</span>
      <div className="leading-tight">
        <p className="text-xs font-semibold">Your firm</p>
        <p className="text-[11px] text-muted-foreground">{line}</p>
      </div>
    </div>
  );
}

function Cta({ text }: { text: string }) {
  if (!text) return null;
  return <span className="inline-flex h-7 items-center rounded-md border border-border bg-muted px-2.5 text-xs font-medium">{text}</span>;
}

export function AdPreview({ format, fields, disclaimer }: { format: FormatKey; fields: FieldValues; disclaimer: string }) {
  const fine = disclaimer.trim() ? <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{disclaimer}</p> : null;
  let body: React.ReactNode;
  switch (format) {
    case "google_rsa": {
      const heads = all(fields, "headline").slice(0, 3);
      const path = all(fields, "path").join(" › ");
      body = (
        <div>
          <p className="text-[11px]"><span className="font-semibold">Ad</span> · yourfirm.example{path ? ` › ${path}` : ""}</p>
          <p className="mt-0.5 text-sm font-medium leading-snug text-primary">{heads.join(" | ") || "Headline"}</p>
          <p className="mt-0.5 text-xs leading-snug">{all(fields, "description").slice(0, 2).join(" ") || "Description"}</p>
          {fine}
        </div>
      );
      break;
    }
    case "meta_feed":
      body = (
        <div className="flex flex-col gap-2">
          <Profile line="Sponsored" />
          <p className="text-xs leading-snug">{first(fields, "primaryText") || "Primary text"}</p>
          <Placeholder ratio="1.91 / 1" />
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 p-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{first(fields, "headline") || "Headline"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{first(fields, "description") || "Description"}</p>
            </div>
            <Cta text={first(fields, "cta")} />
          </div>
          {fine}
        </div>
      );
      break;
    case "linkedin_single":
      body = (
        <div className="flex flex-col gap-2">
          <Profile line="Promoted" />
          <p className="text-xs leading-snug">{first(fields, "introText") || "Intro text"}</p>
          <Placeholder ratio="1.91 / 1" />
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-semibold">{first(fields, "headline") || "Headline"}</p>
            <Cta text={first(fields, "cta")} />
          </div>
          {fine}
        </div>
      );
      break;
    case "youtube_video":
      body = (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Placeholder ratio="16 / 9" />
            <span aria-hidden className="absolute inset-0 grid place-items-center"><Play className="size-8 text-muted-foreground" /></span>
          </div>
          <p className="text-xs font-semibold leading-snug">{first(fields, "longHeadline") || "Long headline"}</p>
          <p className="text-[11px] text-muted-foreground">{first(fields, "description") || "Description"}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-medium">{first(fields, "headline") || "Headline"}</span>
            <Cta text={first(fields, "cta")} />
          </div>
          {fine}
        </div>
      );
      break;
    case "tiktok_feed":
      body = (
        <div className="mx-auto flex w-40 flex-col justify-end gap-1.5 rounded-xl border border-border bg-muted/40 p-2" style={{ aspectRatio: "9 / 16" }}>
          <ThumbsUp aria-hidden className="ml-auto size-4 text-muted-foreground" />
          <p className="text-[11px] font-semibold">@yourfirm</p>
          <p className="text-[11px] leading-snug">{first(fields, "adText") || "Ad text"}</p>
          <Cta text={first(fields, "cta")} />
          {fine}
        </div>
      );
      break;
  }
  return (
    <figure className="m-0 rounded-lg border border-border bg-card p-3" aria-label="Approximate preview">
      {body}
      <figcaption className="mt-2 text-[10px] text-muted-foreground">Approximate preview. The platform may crop or reflow the text.</figcaption>
    </figure>
  );
}
