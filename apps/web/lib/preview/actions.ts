"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { requirePreviewSession } from "./guard";
import {
  decodePreviewState,
  dismissFinding,
  encodePreviewState,
  mintFix,
  PREVIEW_COOKIE,
  readOutVerdict,
  restoreFinding,
  type PreviewState,
} from "./state";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

async function mutate(change: (state: PreviewState) => PreviewState): Promise<void> {
  // The gate again, not only in the layout: a server action is its own entry point and
  // reaching it does not require having rendered the page that offers it.
  await requirePreviewSession();

  const jar = await cookies();
  const next = change(decodePreviewState(jar.get(PREVIEW_COOKIE)?.value));

  jar.set(PREVIEW_COOKIE, encodePreviewState(next), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: YEAR_SECONDS,
  });

  revalidatePath("/", "layout");
}

// A form field is a string or a File. Stringifying the File case would write
// "[object File]" into the cookie as if it were an id.
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function dismissFindingAction(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  const reason = field(formData, "reason");
  if (id.length === 0 || reason.length === 0) return;

  await mutate((state) => dismissFinding(state, id, reason));
}

export async function restoreFindingAction(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  if (id.length === 0) return;

  await mutate((state) => restoreFinding(state, id));
}

export async function mintFixAction(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  if (id.length === 0) return;

  await mutate((state) => mintFix(state, id));
}

export async function readOutVerdictAction(formData: FormData): Promise<void> {
  const id = field(formData, "id");
  if (id.length === 0) return;

  await mutate((state) => readOutVerdict(state, id));
}
