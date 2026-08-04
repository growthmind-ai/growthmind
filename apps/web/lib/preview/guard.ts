import { notFound } from "next/navigation";
import { headers } from "next/headers";

import type { TenantContext } from "@growthmind/shared";

import { getAuth } from "../auth";
import { getTenantContext } from "../tenant";
import { isPreviewViewer, parsePreviewAllowList, type PreviewViewer } from "./access";

export interface PreviewSession {
  readonly viewer: PreviewViewer;
  readonly tenant: TenantContext;
}

async function readViewer(): Promise<PreviewViewer | null> {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch {
    return null;
  }

  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;

  return { userId: session.user.id, email: session.user.email ?? null };
}

// Answers the question without ending the render, for the one place that needs to offer a
// way in rather than guard a way through.
export async function viewerMaySeePreview(): Promise<boolean> {
  const allowed = parsePreviewAllowList(process.env.GROWTHMIND_PREVIEW_USER_IDS);
  return isPreviewViewer(await readViewer(), allowed);
}

// `notFound` rather than a redirect or a refusal: an unfinished surface should not announce
// that it exists. Anyone not on the list gets the same page they would get for a typo.
export async function requirePreviewSession(): Promise<PreviewSession> {
  const allowed = parsePreviewAllowList(process.env.GROWTHMIND_PREVIEW_USER_IDS);
  const viewer = await readViewer();

  if (!isPreviewViewer(viewer, allowed)) {
    notFound();
  }

  const tenant = await getTenantContext();
  if (tenant === null) {
    notFound();
  }

  return { viewer: viewer as PreviewViewer, tenant };
}
