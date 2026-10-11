import { redirect } from "next/navigation";

import { Landing } from "@/components/front-door/landing";
import { auth } from "@/lib/auth/config";
import { googleSignInAvailable } from "@/lib/auth/google/available";
import { landingEnabled } from "@/lib/front-door/flag";
import { landingFor } from "@/lib/policy/workspace";

export const metadata = {
  title: "Allvest Customer OS",
  description: "Know every customer. Know what to do next. Run the whole customer journey in one place.",
};

export default async function Home() {
  const session = await auth();
  // Signed-in people go straight to their own landing screen, exactly as before.
  if (session?.user) redirect(landingFor(session.user.role));
  // With the front door off, a signed-out visitor goes to the sign-in page, exactly as before.
  if (!landingEnabled()) redirect("/login");
  return <Landing googleAvailable={await googleSignInAvailable()} />;
}
