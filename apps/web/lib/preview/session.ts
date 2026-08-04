import { cookies } from "next/headers";

import { decodePreviewState, PREVIEW_COOKIE, type PreviewState } from "./state";

export async function readPreviewState(): Promise<PreviewState> {
  const jar = await cookies();
  return decodePreviewState(jar.get(PREVIEW_COOKIE)?.value);
}

export async function readDismissedIds(): Promise<ReadonlySet<string>> {
  return new Set(Object.keys((await readPreviewState()).dismissed));
}
