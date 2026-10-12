import { NativeCommissionsPage } from "@/components/partners/native/pages";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";

export const dynamic = "force-dynamic";

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireNativePartnerWorkspace();
  return NativeCommissionsPage({ access, searchParams });
}
