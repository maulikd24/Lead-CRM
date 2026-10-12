/**
 * The 404 for a shared report link. It keeps the 404 status, but renders inside one named main landmark (Next's default
 * not-found page has no landmark, so its content falls outside every landmark). It says nothing about whether a token exists.
 */
export default function SharedReportNotFound() {
  return (
    <main aria-labelledby="not-found-title" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-2 p-6 text-center">
      <h1 id="not-found-title" className="font-heading text-xl font-bold">This page could not be found</h1>
      <p className="text-sm text-muted-foreground">Ask the person who sent the link for a new one.</p>
    </main>
  );
}
