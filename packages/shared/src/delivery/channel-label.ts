// What a founder is shown where a Slack channel is named. Slack's own id is not
// recognisable — nobody can tell `#C01AB2CD3EF` from the channel they picked — and
// every sentence carrying one is a sentence they have to act on.
//
// One function rather than a `??` at each call site: the fallback to the id is the
// part that gets forgotten, and forgetting it renders `#null`.

export interface ChannelIdentity {
  readonly channelId: string | null;

  // NULL on the pasted-token path, which types an id and never sees a name, and on
  // every row written before the column existed. Both fall back to the id.
  readonly channelName: string | null;
}

export function channelLabel(identity: ChannelIdentity): string | null {
  // Leading `#` stripped: the templates supply it, and a name stored with one
  // already renders `##growth`.
  const name = (identity.channelName ?? "").trim().replace(/^#+/, "").trim();
  if (name.length > 0) {
    return name;
  }

  const id = (identity.channelId ?? "").trim();

  return id.length > 0 ? id : null;
}
