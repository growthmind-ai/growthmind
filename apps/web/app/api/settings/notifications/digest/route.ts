// Cadence and day are one setting with two dimensions, so the body carries both every
// time — a partial would let a day be stored for a cadence that never existed.
import { settingsNotificationDigestInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";

export const dynamic = "force-dynamic";

export const inputSchema = settingsNotificationDigestInputSchema;

export function handle(_request: Request, _deps: FirstRunRouteDeps): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 501 }));
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
