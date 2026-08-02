import type { ConnectionsService, CreateSourceFn, ScopedDb } from "@growthmind/db";
import { createConnectionsService } from "@growthmind/db";
import type { CredentialKeyResolution, TenantContext } from "@growthmind/shared";

import type { FirstRunRouteDeps } from "./deps";

const UNCOMPOSED_SOURCE: CreateSourceFn = () => {
  throw new Error(
    "onboarding connect: no session-source factory was composed for this request, and the " +
      "credential gate that should have refused first did not",
  );
};

const UNRESOLVED_KEY: CredentialKeyResolution = { ok: false, reason: "malformed_key" };

export function firstRunConnectionsService(
  db: ScopedDb,
  ctx: TenantContext,
  deps: FirstRunRouteDeps,
): ConnectionsService {
  return createConnectionsService(db, ctx, {
    createSource: deps.createSource ?? UNCOMPOSED_SOURCE,

    credentialKey: deps.credentialKey ?? UNRESOLVED_KEY,
    now: deps.now,
  });
}
