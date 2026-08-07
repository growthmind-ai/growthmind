// One person's bell, not the organization's: the body names a class and whether it is
// shown, and never a user or an organization — both come from the session.
import { settingsNotificationBellInputSchema } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";

export const dynamic = "force-dynamic";

export const inputSchema = settingsNotificationBellInputSchema;

export function handle(_request: Request, _deps: FirstRunRouteDeps): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 501 }));
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
