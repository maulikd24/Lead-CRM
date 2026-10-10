import { NativeNetworkPage } from "@/components/partners/native/pages";
import { requireNativePartnerWorkspace } from "@/lib/partners/access";

export const dynamic = "force-dynamic";

export default async function NetworkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireNativePartnerWorkspace();
  return NativeNetworkPage({ access, searchParams });
}
