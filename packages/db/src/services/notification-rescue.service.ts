import type { TenantContext } from "@growthmind/shared";

import type { ScopedExecutor } from "../repositories/types";

export interface UnsettledNotificationsInput {
  // The floor the bell already applies: a notification it will never show is not worth
  // posting to Slack.
  readonly since: Date;

  // A `pending` row claimed after this instant is in flight, not stranded.
  readonly staleClaimsBefore: Date;
}

// The inverse of settled, not the `quiet: no_channel` literal — the commonest way a broken
// connection strands a notification is a `failed` receipt whose credential could not be
// opened, and a sweep keyed on the literal cannot see it. Settled is: any `sent` row, or a
// `quiet` row whose reason is `digest`, which the summary owns.
export function listUnsettledNotificationIds(
  _db: ScopedExecutor,
  _ctx: TenantContext,
  _input: UnsettledNotificationsInput,
): Promise<readonly string[]> {
  throw new Error("O-051 job 2: not implemented");
}
