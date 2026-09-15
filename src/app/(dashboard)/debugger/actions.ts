"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";

const createBugReportSchema = z.object({
  pageUrl: z.string().min(1),
  description: z.string().min(1, "Please describe what happened"),
});

/** Any signed-in user can file one — mirrors the "notify every Admin" idiom already established in
 * clients/actions.ts's auto-assign-failed path, so a new report shows up immediately in every
 * Admin's existing notification bell without a new polling mechanism. */
export async function createBugReportAction(input: { pageUrl: string; description: string }) {
  const session = await requireUser();
  const parsed = createBugReportSchema.parse(input);

  const report = await prisma.bugReport.create({
    data: {
      reportedById: session.user.id,
      pageUrl: parsed.pageUrl,
      description: parsed.description,
    },
  });

  const admins = await prisma.user.findMany({ where: { isActive: true, role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      prisma.notification.create({
        data: {
          userId: admin.id,
          type: "bug_report_filed",
          payload: { bugReportId: report.id, reporterName: session.user.name, description: parsed.description },
        },
      }),
    ),
  );

  return report;
}

export async function resolveBugReportAction(id: string, resolutionNotes: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.bugReport.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolvedById: session.user.id,
      resolvedAt: new Date(),
      resolutionNotes,
    },
  });

  revalidatePath("/debugger");
}
