// THE ANALYTICS ATTACHMENT'S SERVICE, COMPOSED FROM THE ROUTE SEAM (O-008,
// FR-O5, FR-O6, FR-O9).
//
// `createConnectionsService` is SHIPPED and has its own suite. This sprint
// builds the FRONT DOOR to it and reimplements nothing: no second validation
// order, no second refusal table, no second insecure-defaults gate. What lives
// here is the two-line translation from this surface's deps seam to that
// service's own, so the connect and disconnect handlers each read as one call.
import type { ConnectionsService, CreateSourceFn, ScopedDb } from "@growthmind/db";
import { createConnectionsService } from "@growthmind/db";
import type { CredentialKeyResolution, TenantContext } from "@growthmind/shared";

import type { FirstRunRouteDeps } from "./deps";

/**
 * The factory a composition that could not build one leaves behind.
 *
 * UNREACHABLE BY CONSTRUCTION, and therefore loud rather than silent. The
 * production composition builds the source factory and the credential
 * resolution from the SAME resolved key, so an absent factory always travels
 * with a refused key — and the service's own gate refuses on the key FIRST,
 * before it ever reaches a factory. The connect handler guards on the absence
 * explicitly as well. This exists so that if both of those are ever changed,
 * the result is a named error in a log rather than a call to `undefined`.
 */
const UNCOMPOSED_SOURCE: CreateSourceFn = () => {
  throw new Error(
    "onboarding connect: no session-source factory was composed for this request, and the " +
      "credential gate that should have refused first did not",
  );
};

/**
 * FAIL CLOSED. A deps object carrying no credential resolution is treated as
 * an installation that cannot store an outside key safely, which makes the
 * connect attempt a `misconfigured` refusal with no request made and no row
 * written — never an attempt that proceeds on an unstated assumption.
 */
const UNRESOLVED_KEY: CredentialKeyResolution = { ok: false, reason: "malformed_key" };

export function firstRunConnectionsService(
  db: ScopedDb,
  ctx: TenantContext,
  deps: FirstRunRouteDeps,
): ConnectionsService {
  return createConnectionsService(db, ctx, {
    createSource: deps.createSource ?? UNCOMPOSED_SOURCE,
    // THE INHERITED GATE, NEVER RE-DERIVED. A prior audit found a CRITICAL
    // bypass where a normalising gate compared the RAW value while encryption
    // used the NORMALISED one; nothing here re-implements the check, it hands
    // `resolveCredentialKey`'s own result straight through.
    credentialKey: deps.credentialKey ?? UNRESOLVED_KEY,
    now: deps.now,
  });
}
