import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/config";

export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/leads" : "/login");
}
