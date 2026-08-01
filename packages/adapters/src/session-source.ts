// The `SessionSource` port. Types only, every shape is imported from
// @growthmind/shared, which is the single runtime source of truth. There are no sibling
// ports in this package yet: architecture names FlagSource / ObjectStore / ChatSurface
// as future members, and this sprint deliberately ships exactly one.
import type {
  SessionSourceKind,
  SessionSourcePullRequest,
  SessionSourcePullResult,
  SessionSourceValidation,
} from "@growthmind/shared";

/**
 * Two methods, not three.
 *
 * names three responsibilities, validate, pull-since-a-watermark, and report health.
 * The third is satisfied by both result types carrying a terminal outcome, not by a
 * `health` method: health is persisted state on the connection row, derived by the
 * service from the last validate/pull result. A `health` method would create a second
 * source of truth for something the database owns, and would reintroduce exactly the
 * failure of gating on a transient signal instead of persisted state. Carrying the
 * outcome on the result also makes a non-terminal state inexpressible.
 */
export interface SessionSource {
  /** `"posthog"` today. The worker's handler switches exhaustively over this one-member
   * union, so a second implementation is a compile error until every branch is written.
   * No registry, no factory map, no dynamic lookup. */
  readonly kind: SessionSourceKind;

  /** One bounded check that the credentials and project reach real data. Distinguishes
   * wrong-credentials, wrong-project, and unreachable. */
  validate(): Promise<SessionSourceValidation>;

  /**
   * Walks backwards from the newest event (row 1: ordering is strictly newest-first)
   * until the cursor is literally `null`, the previous watermark is crossed, or the
   * page cap is hit.
   *
   * A page-cap stop is not an end-of-data signal: the result reports `contiguous:
   * false` with a `resumeBefore` cursor, so the caller knows it must not advance the
   * watermark. A mid-walk failure returns `ok: false` with the newest events already
   * retrieved on `partialEvents`.
   */
  pull(request: SessionSourcePullRequest): Promise<SessionSourcePullResult>;
}
