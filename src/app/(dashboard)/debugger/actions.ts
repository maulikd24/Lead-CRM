"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser, requireRole } from "@/lib/auth/require-role";

const createBugReportSchema = z.object({
  pageUrl: z.string().min(1),
  description: z.string().min(1, "Please describe what happened"),
});

// Screenshots and short log files only — generous enough for a screenshot, small enough to stay
// well under the Server Action body limit set in next.config.ts.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];

/** Any signed-in user can file one — mirrors the "notify every Admin" idiom already established in
 * clients/actions.ts's auto-assign-failed path, so a new report shows up immediately in every
 * Admin's existing notification bell without a new polling mechanism. */
export async function createBugReportAction(formData: FormData) {
  const session = await requireUser();
  const parsed = createBugReportSchema.parse({
    pageUrl: formData.get("pageUrl"),
    description: formData.get("description"),
  });

  const attachment = formData.get("attachment");
  let attachmentUrl: string | undefined;
  let attachmentName: string | undefined;
  let attachmentFailed = false;
  if (attachment instanceof File && attachment.size > 0) {
    // Size/type are the user's own mistake to fix and resubmit — worth blocking on.
    if (attachment.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment is too large — please keep it under 8MB");
    }
    if (!ALLOWED_ATTACHMENT_TYPES.includes(attachment.type)) {
      throw new Error("Attachment must be an image, PDF, or text file");
    }
    // An upload failure (e.g. Blob storage misconfigured) must not cost the user their whole report —
    // file it without the attachment and tell them, rather than losing the description too.
    try {
      const blob = await put(`bug-reports/${session.user.id}-${Date.now()}-${attachment.name}`, attachment, {
        access: "public",
      });
      attachmentUrl = blob.url;
      attachmentName = attachment.name;
    } catch (error) {
      console.error("Bug report attachment upload failed", error);
      attachmentFailed = true;
    }
  }

  const report = await prisma.bugReport.create({
    data: {
      reportedById: session.user.id,
      pageUrl: parsed.pageUrl,
      description: parsed.description,
      attachmentUrl,
      attachmentName,
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

  return { ...report, attachmentFailed };
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
