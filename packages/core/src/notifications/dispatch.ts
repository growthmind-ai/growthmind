// A lease with no expiry is a deadlock, and one shorter than the call is a double post. A
// dispatch attempt is a single bounded HTTP call, so a claim older than a few minutes is a
// crashed process rather than a slow one. Ratified 2026-08-07.
export const NOTIFICATION_DISPATCH_CLAIM_TTL_MS = 5 * 60 * 1_000;

export const NOTIFICATION_DISPATCH_MAX_ATTEMPTS = 5;

// Derived, not chosen: the sweep's period IS the unattended-work horizon the TTL already
// declares, so the product holds one answer to that question rather than two. Bound to the
// crontab by the rescue tick's drift test.
export const NOTIFICATION_RESCUE_TICK_INTERVAL_MS = NOTIFICATION_DISPATCH_CLAIM_TTL_MS;

export function dispatchClaimsExpireBefore(_at: Date): Date {
  throw new Error("O-051 job 2: not implemented");
}
