import { notFound } from "next/navigation";

import { NativeStatementPage } from "@/components/partners/native/pages";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export default async function StatementPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireNativePartnerWorkspace();
  const { partnerId } = await params;
  if (!ID.test(partnerId)) notFound();
  return NativeStatementPage({ access, partnerId, searchParams });
}
