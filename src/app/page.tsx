import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect(session.user.role === "DEALER" ? "/dealer-desk" : "/dashboard");
}
