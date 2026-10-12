import { NativeStatementsPage } from "@/components/partners/native/pages";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";

export const dynamic = "force-dynamic";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireNativePartnerWorkspace();
  return NativeStatementsPage({ access, searchParams });
}
