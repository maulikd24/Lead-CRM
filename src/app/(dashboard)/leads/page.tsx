import { redirect } from "next/navigation";

import { requireAccess } from "@/lib/auth/require-role";

/** The leads board is the Board view of /clients now (one place, the same filters as the list). Old links land there. */
export default async function LeadsPage() {
  await requireAccess("clients");
  redirect("/clients?view=board");
}
