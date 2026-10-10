import type { buildStatementVM } from "@/lib/partners/native/view-models";
import { Assumptions, TotalsList } from "./statements";
import { LightWhilePrinting, PrintButton } from "./print-statement";

type VM = ReturnType<typeof buildStatementVM>;

/** The standalone statement: every line, no app chrome, built to print on A4 or be saved as a PDF. */
export function PrintableStatement({ vm, generatedOn }: { vm: VM; generatedOn: string }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-background p-6 text-foreground print:max-w-none print:p-0">
      <LightWhilePrinting />
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Commission statement</p>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">{vm.partner.name}</h1>
          <p className="text-sm text-muted-foreground"><span className="font-mono">{vm.partner.code}</span> · {vm.partner.type} · {vm.partner.tier.label} tier</p>
        </div>
        <PrintButton />
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Period</dt><dd className="font-medium">{vm.periodLabel}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="font-medium">{vm.isEstimate ? "Estimate" : (vm.payoutStatus?.label ?? vm.runStatus?.label ?? "—")}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Empanelment</dt><dd className="font-medium">{vm.empanelment.label}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Bank account</dt><dd className="font-medium">{vm.bank.label}{vm.bank.tail ? ` ${vm.bank.tail}` : ""}</dd></div>
        {vm.externalRef && <div><dt className="text-xs text-muted-foreground">Finance reference</dt><dd className="font-mono">{vm.externalRef}</dd></div>}
      </dl>

      {!vm.check.matches && <p role="alert" className="border border-border p-2 text-sm">{vm.check.message}</p>}

      <section aria-labelledby="st-lines">
        <h2 id="st-lines" className="mb-2 font-heading text-base font-semibold">Accruals</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Date</th><th className="py-1.5 pr-3 font-medium">Revenue</th><th className="py-1.5 pr-3 font-medium">Customer</th><th className="py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {vm.lines.rows.map((l) => (
              <tr key={l.id} className="break-inside-avoid border-b border-border/60">
                <td className="py-1 pr-3">{l.date}</td><td className="py-1 pr-3">{l.type}</td><td className="py-1 pr-3 font-mono text-xs">{l.clientCode}</td><td className="py-1 text-right tabular-nums">{l.amount}</td>
              </tr>
            ))}
            {vm.lines.rows.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">No accruals in this statement.</td></tr>}
          </tbody>
        </table>
      </section>

      {vm.adjustments.length > 0 && (
        <section aria-labelledby="st-adj">
          <h2 id="st-adj" className="mb-2 font-heading text-base font-semibold">Adjustments</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {vm.adjustments.map((a) => (
                <tr key={a.id} className="break-inside-avoid border-b border-border/60"><td className="py-1 pr-3">{a.date}</td><td className="py-1 pr-3">{a.reason}</td><td className="py-1 text-right tabular-nums">{a.amount}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="st-tot" className="break-inside-avoid">
        <h2 id="st-tot" className="mb-2 font-heading text-base font-semibold">Totals</h2>
        <TotalsList totals={vm.totals} />
        <Assumptions items={vm.assumptions} />
      </section>

      <footer className="border-t border-border pt-3 text-xs text-muted-foreground">Generated {generatedOn}. Figures are estimates recorded by the earnings engine; this document is not a payment instruction.</footer>
    </main>
  );
}
