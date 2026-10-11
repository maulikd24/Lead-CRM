// Which jobs a change set needs (pure). Doc-only and Android-only changes run the cheap static job and nothing else.
const any = (files, tests) => files.some((f) => tests.some((t) => (t instanceof RegExp ? t.test(f) : f.startsWith(t))));

const DOC_ONLY = [/^docs\//, /\.md$/, /^android-app\//, /^public\//, /^LICENSE/];
const isDoc = (f) => DOC_ONLY.some((r) => (r instanceof RegExp ? r.test(f) : f.startsWith(r)));

export function classify(files) {
  const code = files.some((f) => !isDoc(f));
  return {
    code,
    db: any(files, ["prisma/", "src/lib/", "scripts/ci/", "ci/", "package.json", "package-lock.json", /\.db\.test\.ts$/]),
    ui: any(files, ["src/app/", "src/components/", "src/lib/access/", "src/lib/nav", "prisma/", "e2e/", "playwright.config.ts", "package.json", "package-lock.json", "next.config.ts", "ci/", "scripts/ci/e2e.mjs"]),
    layout: any(files, ["src/app/(dashboard)/", "src/components/", "scripts/layout-budget/", "src/app/globals.css"]),
  };
}
