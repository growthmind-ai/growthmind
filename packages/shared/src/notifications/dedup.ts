// Dedup keys are built from stable minted ids only (D12) — by signature, no display
// string can enter a key.

// One notification per (finding, channel): the notification records "this finding reached
// this channel", so its identity is the delivery identity (ADD D-4). Identical across a
// re-mark, so a D4 retry hits the conflict and changes nothing.
export function buildFindingDeliveredDedupKey(findingId: string, channelId: string): string {
  return `finding_delivered:${findingId}:${channelId}`;
}

// The repo mints eventId with randomUUID at the write. The key exists to satisfy the
// unique column and D12; the once-per-transition gate is the UPDATE returning a row.
export function buildKeysRevokedDedupKey(eventId: string): string {
  return `keys_revoked:${eventId}`;
}

// No arguments, deliberately: the type constant alone is the whole key, so one row per
// org can ever exist — a second key's first contact hits the conflict (ruling 1, ADD D-2).
export function buildAgentFirstContactDedupKey(): string {
  return "agent_first_contact";
}

// The fresh row's own id: per-mint dedup is the intent, and a key id is minted once. Key
// ids do churn across revoke-and-re-mint, which is why `keys_revoked` mints an event id of
// its own instead — the two are opposite sides of D12's fork.
export function buildKeyCreatedDedupKey(keyId: string): string {
  return `key_created:${keyId}`;
}

// randomUUID at the write, the keys_revoked shape: the once-per-transition gate is the
// cursor clear that returned a row, and the key exists to satisfy the unique column.
export function buildBackfillCompleteDedupKey(eventId: string): string {
  return `backfill_complete:${eventId}`;
}

export function buildSlackDisconnectedDedupKey(eventId: string): string {
  return `slack_disconnected:${eventId}`;
}

// The run that tripped the detector, so a later trip on the same project is a new fact
// rather than a conflict. Both inputs are minted ids.
export function buildAnalysisFailingDedupKey(projectId: string, runId: string): string {
  return `analysis_failing:${projectId}:${runId}`;
}

// The change row's own id, which the upsert holds fixed across a re-report — so a second
// report of the same change cannot mint a second acknowledgement or a second clock.
export function buildChangeReportedDedupKey(changeId: string): string {
  return `change_reported:${changeId}`;
}

// One readout per change for as long as the row exists: a re-run of the tick over a row
// already read out hits this key and writes nothing.
export function buildChangeReadoutDedupKey(changeId: string): string {
  return `change_readout:${changeId}`;
}

// The window's own end — the due day's UTC boundary, identical across every hourly run of
// that day, which is why a later run of the same day cannot mint a second summary.
export function buildDigestDedupKey(organizationId: string, windowEndIso: string): string {
  return `digest:${organizationId}:${windowEndIso}`;
}
