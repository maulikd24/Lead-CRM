export type FileKind = "sheet" | "doc" | "image" | "other";

export function fileKind(name: string, type: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["csv", "xls", "xlsx", "tsv"].includes(ext) || type.includes("csv") || type.includes("spreadsheet")) return "sheet";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "txt"].includes(ext) || type === "application/pdf" || type.startsWith("text/")) return "doc";
  return "other";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** The early, friendly check (the server checks again). Returns a sentence to show, or null when the file is fine. */
export function checkFile(file: { name: string; size: number; type: string }, accept: string | undefined, maxBytes: number): string | null {
  if (accept) {
    const allowed = accept.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
    const ext = `.${file.name.toLowerCase().split(".").pop() ?? ""}`;
    const ok = allowed.some((a) => (a.startsWith(".") ? a === ext : a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : a === file.type.toLowerCase()));
    if (!ok) {
      const exts = allowed.filter((a) => a.startsWith(".")).map((a) => a.slice(1).toUpperCase());
      return `That file is not the right kind. Choose ${exts.length ? `a ${exts.join(" or ")} file` : "a supported file"}.`;
    }
  }
  if (file.size > maxBytes) return `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  return null;
}
