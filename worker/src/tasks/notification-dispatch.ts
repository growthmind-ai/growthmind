// Lease-less in v1 (ADD D-1): idempotent by the unique send key, single-runner
// assumption; job 2 adds the claim lease and owns retry policy.
export async function runNotificationDispatch(_payload: unknown): Promise<void> {
  throw new Error("O-051 W1+: not implemented");
}
