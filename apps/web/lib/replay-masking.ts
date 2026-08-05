// Session replay records the DOM, so it is a PII surface whichever vendor carries it, and
// it defaults to recording every word on screen (B-049). Both recorders in this app are
// configured from here so they cannot drift into two different answers.
// see .ai/prds/04-08-26/add-o-027-replay-source-port.md § AD-5a
export const REPLAY_MASKING = {
  maskAllInputs: true,

  // Catch-all rather than a class list: a masking rule that misses has to fail toward
  // masking, and rrweb offers no unmask seam to carve exceptions back out of.
  maskTextSelector: "*",
} as const;

// What neither recorder can reach: rrweb serialises HTML attributes verbatim and exposes
// no hook to mask them, so `title`, `alt`, `aria-label`, `placeholder` and `data-*` must
// not carry customer or end-user text. Enforced by
// apps/web/__tests__/replay-attribute-exposure.test.ts, not by this comment.
