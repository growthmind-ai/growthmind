// THE PREAMBLE EVERY ONBOARDING HANDLER RUNS, IN ONE PLACE (O-008, AD-16).
//
// AD-16: "Every handler's preamble is identical and is the whole tenancy
// story: `getTenantContext()` → `null` ⇒ 401; `ensureProject(db, ctx)` ⇒ the
// project id; `createXRepo(db, ctx)`. No repository factory takes an
// organization id. No route body carries one."
//
// The three steps below are that story, written once. Each handler still spells
// the sequence out — five lines, the same five, in the same order — because
// the ORDER is load bearing and a reviewer should be able to read it without
// following a call:
//
//   1. `requireTenant` — no session, no answer. Before the body is even read,
//      so an anonymous caller learns nothing about which shapes we accept.
//   2. `inputSchema.safeParse(await readRequestBody(request))` — the strict
//      parse (AD-16a). A refusal happens HERE, before any query and before any
//      write, which is why `a project id belonging to another org is refused,
//      not served` can assert that no request was made and no row was written.
//   3. `ensureProject(db, ctx)` — the project, derived from the context. Only
//      after the body has been accepted: a refused request writes nothing.

import type { TenantContext } from "@growthmind/shared";

import { describeBodyRefusal, refusalResponse, SIGNED_OUT, type ParseErrorLike } from "./refusals";
import type { FirstRunRouteDeps } from "./deps";

/** The session, or the response to send instead of one. */
export type TenantGate =
  | { readonly ok: true; readonly ctx: TenantContext }
  | { readonly ok: false; readonly response: Response };

/**
 * Step 1. The ONLY tenancy input on this surface.
 *
 * `null` is a 401 carrying no data, not an empty payload: the whole reconciled
 * status is exactly what a signed-out caller must not receive, and answering
 * `200 {}` would make "nothing has happened yet" and "you are not signed in"
 * the same sentence.
 */
export async function requireTenant(deps: FirstRunRouteDeps): Promise<TenantGate> {
  const ctx = await deps.tenant();
  return ctx === null ? { ok: false, response: refusalResponse(SIGNED_OUT) } : { ok: true, ctx };
}

/**
 * Step 2's input. Whatever the client sent, as a value a strict schema can
 * refuse — never a throw.
 *
 * AN ABSENT BODY IS `{}`, NOT A REFUSAL, and that is deliberate. Six of the
 * eight routes declare no input at all, so `POST` with nothing attached is
 * their ORDINARY request; refusing it would make a correct client's simplest
 * call a 400. A body that is present but is not JSON becomes `null`, which the
 * strict schema refuses as `invalid_type` and `describeBodyRefusal` maps to
 * `invalid_body` (AD-16a, measured trap 3) — a 400 with our sentence rather
 * than a 500 from an uncaught parse error.
 *
 * A `GET` never has one, and asking for its body would throw on some runtimes,
 * so it short-circuits.
 */
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

/**
 * Step 2's refusal. A sentence from our table, a 400, and never a raw Zod
 * message — see `./refusals.ts` for the three measured shapes it survives.
 */
export function refuseBody(error: ParseErrorLike): Response {
  return refusalResponse(describeBodyRefusal(error));
}
