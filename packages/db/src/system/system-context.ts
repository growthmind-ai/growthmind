import type { TenantContext } from "@growthmind/shared";

import type { PollableConnection } from "./pollable-connections";
import { SYSTEM_ACTOR, systemContextFor } from "./system-actor";

export function systemTenantContextFor(connection: PollableConnection): TenantContext {
  return systemContextFor(SYSTEM_ACTOR.SESSION_SOURCE_POLL, connection);
}
