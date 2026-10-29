import { redirect } from "next/navigation";

import { requireAccess } from "@/lib/auth/require-role";
import { canonicalViewQuery, clientsHref } from "@/lib/clients/views";

/** The pipeline board is the Board view of /clients now. Old links (and their quick filter or RM) land on the same board. */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ filter?: string; rm?: string }> }) {
  await requireAccess("clients");
  const { filter, rm } = await searchParams;
  redirect(clientsHref(canonicalViewQuery({ view: "board", filter, rm })));
}
