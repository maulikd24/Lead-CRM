import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";
import { landingFor } from "@/lib/policy/workspace";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect(landingFor(session.user.role));
}
