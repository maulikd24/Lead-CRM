"use client";

import dynamic from "next/dynamic";

import type { Role } from "@/generated/prisma/client";

const AppTour = dynamic(() => import("./app-tour").then((mod) => mod.AppTour), {
  ssr: false,
});

export function AppTourLoader(props: { role: Role; hasSeenTour: boolean }) {
  return <AppTour {...props} />;
}
