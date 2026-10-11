"use client";

import { useId, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Image as ImageIcon, File as FileIcon, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { checkFile, fileKind, formatBytes, type FileKind } from "./file-dropzone-logic";

const ICON: Record<FileKind, typeof FileIcon> = { sheet: FileSpreadsheet, doc: FileText, image: ImageIcon, other: FileIcon };

/**
 * A drop target for one file, in the "halo" style: a soft glow ring around the zone while a file is dragged over it, a file-type icon and
 * the file's name and size once chosen. The control underneath is still a real file input, so it works with a click, the keyboard and
 * assistive tech; dragging is only a shortcut. The glow appears once on drag-over (150ms, no loop) and is off under reduced motion.
 * The idea follows Cult UI's halo dropzone (MIT, https://www.cult-ui.com), written in our own code and tokens.
 */
export function FileDropzone({ file, onFile, accept, maxBytes, label, hint, disabled, name, required }: { file: File | null; onFile: (f: File | null) => void; accept?: string; maxBytes: number; label: string; hint?: string; disabled?: boolean; /** Set a name (and `required`) to use the zone inside a <form>: a dropped file is placed in the real input so the form submits it. */ name?: string; required?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(f: File | undefined) {
    if (!f) return;
    const problem = checkFile(f, accept, maxBytes);
    setError(problem);
    if (problem) {
      if (input.current) input.current.value = "";
      return;
    }
    onFile(f);
  }

  const Icon = file ? ICON[fileKind(file.name, file.type)] : UploadCloud;
  return (
    <div>
      <div
        data-over={over ? "true" : undefined}
        data-filled={file ? "true" : undefined}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (disabled) return;
          const dropped = e.dataTransfer.files;
          if (input.current && dropped?.length && !checkFile(dropped[0], accept, maxBytes)) input.current.files = dropped;
          take(dropped?.[0]);
        }}
        className={cn(
          "relative flex min-h-24 items-center gap-3 rounded-xl border border-dashed border-input bg-muted/30 px-4 py-3 transition-[border-color,box-shadow,background-color] duration-150 motion-reduce:transition-none",
          "data-[over=true]:border-primary data-[over=true]:bg-primary/5 data-[over=true]:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent)]",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40",
          "data-[filled=true]:border-solid data-[filled=true]:bg-card",
          disabled && "opacity-60",
        )}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-[var(--primary-ink)]" aria-hidden>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block cursor-pointer text-sm font-medium after:absolute after:inset-0">
            {file ? file.name : label}
          </label>
          <p className="truncate text-xs text-muted-foreground">{file ? `${formatBytes(file.size)}. Choose another file to replace it.` : (hint ?? "Drop a file here, or click to choose one.")}</p>
        </div>
        <input
          id={id}
          ref={input}
          type="file"
          name={name}
          required={required}
          accept={accept}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => take(e.target.files?.[0])}
        />
        {file && (
          <button
            type="button"
            onClick={() => {
              onFile(null);
              setError(null);
              if (input.current) input.current.value = "";
            }}
            aria-label={`Remove ${file.name}`}
            className="relative z-10 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={cn("mt-1.5 text-sm", error ? "text-destructive" : "sr-only")}>
        {error ?? (file ? `${file.name} selected` : "")}
      </p>
    </div>
  );
}
