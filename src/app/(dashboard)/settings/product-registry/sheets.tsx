"use client";

import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Sheet, UrlSheet, useUrlSheet } from "@/components/workspace";
import type { FormFields } from "@/lib/registry/form-parse";
import { ProductForm } from "./product-form";

/** The two forms live at page level, never inside a product's detail: the detail renders twice on a phone (pane and sheet) and a form must exist once. */
export function NewProductSheet() {
  return (
    <UrlSheet name="new-product" title="New product" description="Creates a draft. Nothing is citable until a second Admin approves it." triggerClassName="inline-flex h-8 items-center rounded-md bg-primary px-2.5 text-[0.8rem] font-semibold text-primary-foreground hover:bg-primary/80" trigger="New product">
      <NewProductBody />
    </UrlSheet>
  );
}
function NewProductBody() {
  const { hide } = useUrlSheet("new-product");
  return <ProductForm mode="create" onDone={hide} />;
}

export type DraftEdit = { productId: string; versionId: string; name: string; fields: FormFields };

export function EditDraftSheet({ drafts }: { drafts: DraftEdit[] }) {
  const search = useSearchParams();
  const { open, hide } = useUrlSheet("edit-draft");
  const selected = search?.get("item");
  const draft = drafts.find((d) => d.productId === selected);
  return (
    <Sheet name="edit-draft" open={open && !!draft} onClose={hide} title={draft ? `Edit draft: ${draft.name}` : "Edit draft"} description="Saving keeps it a draft. Submit it for review from the product page.">
      {draft && <ProductForm key={draft.versionId} mode="edit" versionId={draft.versionId} initial={draft.fields} onDone={hide} />}
    </Sheet>
  );
}

export function EditDraftButton() {
  const { show } = useUrlSheet("edit-draft");
  return <Button size="sm" variant="outline" onClick={show}>Edit draft</Button>;
}
