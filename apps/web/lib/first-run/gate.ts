import type { TenantContext } from "@growthmind/shared";

import { describeBodyRefusal, refusalResponse, SIGNED_OUT, type ParseErrorLike } from "./refusals";
import type { FirstRunRouteDeps } from "./deps";

export type TenantGate =
  | { readonly ok: true; readonly ctx: TenantContext }
  | { readonly ok: false; readonly response: Response };

export async function requireTenant(deps: FirstRunRouteDeps): Promise<TenantGate> {
  const ctx = await deps.tenant();
  return ctx === null ? { ok: false, response: refusalResponse(SIGNED_OUT) } : { ok: true, ctx };
}

export async function readRequestBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") {
    return {};
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }

  if (text.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function refuseBody(error: ParseErrorLike): Response {
  return refusalResponse(describeBodyRefusal(error));
}
