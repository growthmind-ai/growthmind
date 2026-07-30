// The PostHog implementation of the `SessionSource` port (O-003 D-6, D-11).
//
// It owns the walk, session assembly, identity resolution, and the overlap
// subtraction.
//
// HOT-PATH CONSTRAINT, quoted so nobody "optimises" it back:
// docs/decisions/0001-posthog-retrieval-latency.md §6 records that the events
// list API satisfied retrievability in 40 of 40 trials, while the HogQL query
// API hit the 120-second ceiling in 40 of 40 and surfaced no fresh event.
// HogQL joins persons and is viable for a batch backfill of identity; it is
// PROHIBITED on the poll path, and a grep test asserts no `/query` call
// exists here.
//
// THE WALK (D-6a–d), in the order it must happen:
//   1. If `backfillBefore` is set, resume the unfinished BACKWARD walk from it
//      before starting a new forward pass.
//   2. Page 1: `after = formatPostHogInstant(watermarkAt −
//      OVERLAP_WINDOW_SECONDS)`, `limit = PAGE_LIMIT`.
//   3. Follow `next` VERBATIM. Terminate when `next` is literally `null`,
//      when `MAX_PAGES_PER_RUN` is hit, or when the oldest item on a page is
//      at or before the previous watermark. NEVER treat "fewer rows than
//      `limit`" as an end signal.
//   4. `newestObservedAt` is PAGE 1, ITEM 0 — the ordering is strictly
//      newest-first, so it is never accumulated from the last page.
//   5. `contiguous` is true only for (3)'s first or third termination. A
//      page-cap stop sets `contiguous: false` and a `resumeBefore` cursor,
//      and the caller must not advance the watermark.
//
// TYPED STUB (O-003 scaffold): the signature is final; the body throws.
import type { SessionSource } from "../session-source";
import type { PostHogSourceConfig, PostHogSourceDeps } from "./deps";

/**
 * The one implementation, imported BY NAME at the composition root. There is
 * no registry, no factory table, and no dynamic lookup anywhere — the worker
 * switches exhaustively over a one-member Zod union the compiler checks, so
 * the day a second adapter lands the missing branch is a compile error rather
 * than a silent fallthrough.
 */
export function createPostHogSessionSource(
  _config: PostHogSourceConfig,
  _deps: PostHogSourceDeps,
): SessionSource {
  throw new Error("TYPED STUB (O-003 scaffold): createPostHogSessionSource");
}
