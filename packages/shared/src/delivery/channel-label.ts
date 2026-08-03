export interface ChannelIdentity {
  readonly channelId: string | null;

  // NULL on the pasted-token path and on rows predating the column.
  readonly channelName: string | null;
}

// One function rather than a `??` per call site: the fallback to the id is the half
// that gets forgotten, and forgetting it renders `#null`. The leading `#` is stripped
// because the templates supply it.
export function channelLabel(identity: ChannelIdentity): string | null {
  const name = (identity.channelName ?? "").trim().replace(/^#+/, "").trim();
  if (name.length > 0) {
    return name;
  }

  const id = (identity.channelId ?? "").trim();

  return id.length > 0 ? id : null;
}
