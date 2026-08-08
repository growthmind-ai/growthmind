// Cadence and day are one setting with two dimensions, so the body carries both every
// time — a partial would let a day be stored for a cadence that never existed.
import { createNotificationSettingsRepo } from "@growthmind/db";
import { PAGES_SAVED, settingsNotificationDigestInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";

export const dynamic = "force-dynamic";

export const inputSchema = settingsNotificationDigestInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await createNotificationSettingsRepo(deps.db, gate.ctx).save({
    cadence: parsed.data.cadence,
    day: parsed.data.day,
  });

  return Response.json({ saved: true, sentence: PAGES_SAVED });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
