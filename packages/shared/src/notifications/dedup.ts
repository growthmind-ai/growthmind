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
