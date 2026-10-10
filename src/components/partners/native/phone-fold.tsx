"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** How many rows a phone shows before "View all". */
export const PHONE_ROWS = 5;

/**
 * Phone density rule: a long table shows its first five rows on a phone and a "View all" button that opens the whole page
 * of rows in a bottom sheet. On a wider screen nothing changes. The rows are the same server-rendered table, shown twice
 * (in place, and inside the sheet), so no data is fetched or lost.
 */
export function PhoneFold({ count, title, children }: { count: number; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="max-sm:[&_tbody>tr:nth-child(n+6)]:hidden max-sm:[&_ul>li:nth-child(n+6)]:hidden">{children}</div>
      {count > PHONE_ROWS && (
        <div className="px-4 pt-3 sm:hidden">
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            View all {count}
          </Button>
        </div>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto p-0 sm:hidden">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="pb-4">{children}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
