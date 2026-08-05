// Masking is OFF while the only people using this app are us. Recordings of an unmasked
// session are the whole point of having them — a fully masked replay shows asterisks
// moving and teaches nobody anything — and the sessions being recorded today are the
// team's own. Password fields stay masked regardless: a credential in a third party's
// storage is a different kind of harm from a workspace name.
//
// THIS MUST CHANGE BEFORE ANYONE OUTSIDE THE TEAM USES THE APP. Their workspace names,
// their findings text and their own page paths are the customer data this deliberately
// stops protecting. B-050 in ../shared/bugs/growthmind.md is the trip-wire.
export const REPLAY_MASKING = {
  maskAllInputs: false,

  maskInputOptions: { password: true },
} as const;

// Independent of the switch above: rrweb serialises HTML attributes verbatim and exposes
// no hook to mask them, so `title`, `alt`, `aria-label`, `placeholder` and `data-*` must
// not carry customer or end-user text. Enforced by
// apps/web/__tests__/replay-attribute-exposure.test.ts, not by this comment.
