// Where the three tools' data comes from.
//
// Why this is a port and not a repository call
//
// There is no `findings` table in this branch. `packages/db/src/schema/` holds finding
// signatures, dismissals and deliveries (the ledger and the delivery record) and
// nothing that a finding, a fix, or a piece of evidence is stored in. The analysis lane
// that writes them is a later outcome's work.
//
// So the three tools read through an interface, exactly as the delivery lane reads its
// projects through `DeliveryLaneSource` (`worker/src/tasks/delivery-tick.ts`) for the
// same missing table. Naming the read as a port keeps the gap one implementation wide
// and visible: the day `findings` lands, a repository behind this interface is the
// whole change, and nothing in `./server.ts` moves.
//
// The contract every implementation is held to. This is the tenant boundary
//
// Every query below carries `organizationId`, and it is required on all three. The
// caller takes it from the authenticated credential and from nowhere else; no tool
// input can name an organization (`packages/shared/src/mcp/types.ts` forbids the key
// outright), so there is no path by which a request body could reach this field.
//
// An implementation must:
//
// 1. Filter by `organizationId` in the same query that filters by the
//  Requested ID. Never fetch by id and then check the organization: that is
//  two steps, and the second one runs only on the "found" path, which makes
//  the pair distinguishable by time even when the answers are identical.
//  One `where` clause, both conditions.
//
// 2. Return `null` for a row in another organization, indistinguishably from
//  a row that does not exist. This is what lets `./server.ts` have exactly
//  one `null` branch and therefore exactly one answer — it never learns why
//  the read came back empty, so it cannot leak the reason.
//
// 3. Resolve `projectId` inside the organization too. A project id from
//  another organization narrows to nothing and yields an empty list with a
//  truthful window — the same answer a project id that never existed gets.
//
// 4. Return at most `limit` rows, ordered soonest `resultsBy` first, and
//  `totalOpen` counted over everything in scope. The caller re-sorts what
//  it is given (cheap at 25 rows) so the order of a response never rests on
//  an implementation's `order by` — but which rows are in a truncated list
//  does rest on it, which is why the ordering is stated here as a
//  requirement rather than assumed.
import type { FixSpecInput } from "@growthmind/core";
import type { FindingEvidence, FixStatus, McpMeasuredCount } from "@growthmind/shared";

/**
 * One open fix, as the store holds it.
 *
 * `status` is deliberately absent. The wire row's status is the literal `"open"`
 * (`openFixSummarySchema`), so the caller writes it rather than copying it: a store
 * that returned a verified fix in a list of open ones would fail to parse, instead of
 * quietly inviting an agent to redo work that already landed.
 *
 * `impact` is the wire mirror (`McpMeasuredCount`) rather than core's branded
 * `MeasuredCount`, because a branded value cannot survive JSON. Its brand is a
 * module-private symbol and `JSON.stringify` drops symbol keys
 * (`packages/shared/src/mcp/types.ts` explains the mirror at length). The schema
 * re-states all three of core's invariants as runtime checks, so a count core would
 * refuse is refused here too.
 */
export interface OpenFixRow {
  readonly fixId: string;
  readonly findingId: string;
  /** One sentence about what is wrong, in plain English. */
  readonly summary: string;
  readonly impact: McpMeasuredCount;
  /** ISO-8601 UTC. */
  readonly openedAt: string;
  /** ISO-8601 UTC. The date does not move. */
  readonly resultsBy: string;
}

/**
 * One fix in full, as the store holds it, with the fix spec still in its structured
 * form.
 *
 * `spec` is a `FixSpecInput` and not a string, and that is the seam `packages/shared`
 * named and could not cross: `renderFixSpec` lives in `@growthmind/core`,
 * `packages/shared` may not depend on it, and so the envelope carries the rendered spec
 * as one opaque `specText`. `apps/web` may import both, so the join happens in
 * `./server.ts`, one call, one place. Storing the structured state rather than the
 * sentences is what keeps the renderer the single producer of those sentences:
 * re-rendering an old fix after a wording change gives the new wording, and there is no
 * second copy of the prose to drift.
 *
 * `attemptsAllowed` and `dateIsFinal` are absent for the same reason `status` is absent
 * from `OpenFixRow`: they are contract constants (`FIX_ATTEMPT_CEILING`, `true`), and a
 * store that could state them could state them wrongly.
 */
export interface FixRecord {
  readonly fixId: string;
  readonly findingId: string;
  readonly status: FixStatus;
  readonly spec: FixSpecInput;
  /** Which attempt this is, counting from 1. */
  readonly attempt: number;
  /** What earlier attempts already landed, one plain sentence each. Empty on attempt 1. */
  readonly alreadyLanded: readonly string[];
  readonly impact: McpMeasuredCount;
  /** ISO-8601 UTC. */
  readonly resultsBy: string;
}

/**
 * One finding, in the shape the tool answers with.
 *
 * Why this is stated here rather than imported, which is a real wart and worth naming
 * precisely: `@growthmind/shared` exposes exactly one entry point (`exports: { ".":
 * "./src/index.ts" }`), and its barrel re-exports `listOpenFixesOutputSchema` and
 * `fixSpecEnvelopeSchema` but not `getFindingOutputSchema` or `GetFindingOutput`. There
 * is no import path to the type, and this package may not edit that one.
 *
 * So this interface is assembled from the pieces the barrel does export
 * (`McpMeasuredCount`, `FindingEvidence`) plus the primitives, and the drift that would
 * otherwise follow is closed two ways rather than hoped away:
 *
 * The runtime authority is never this type. `./server.ts` parses every
 *  `get_finding` answer through the descriptor's own `outputSchema` — the
 *  same object `packages/shared` binds to the tool — reached via
 *  `MCP_TOOLS`, which the barrel does export. A record this type accepts and
 *  the contract does not is refused before it reaches a coding agent.
 *
 * A named test parses a record of this type through that schema, so a field
 *  that the contract adds, renames or tightens fails by name in
 *  `__tests__/mcp/route.test.ts` rather than in somebody's agent.
 *
 * When this surface moves to a `packages/mcp` that may import Zod directly, the type
 * comes back from the schema and this declaration goes away.
 */
export interface FindingRecord {
  readonly findingId: string;
  /** `null` when nobody has asked for this to be fixed yet. */
  readonly fixId: string | null;
  readonly headline: string;
  readonly detail: string;
  readonly surface: {
    /** What a person calls this place: "the invite screen". */
    readonly name: string;
    /** The file it resolves to, or `null` when it does not resolve. Never a guess, an
     * agent given a wrong path edits the wrong file with complete confidence. */
    readonly path: string | null;
  };
  readonly affected: McpMeasuredCount;
  /** ISO-8601 UTC. */
  readonly firstSeenAt: string;
  /** ISO-8601 UTC. */
  readonly lastSeenAt: string;
  /** At least one. A finding with nothing behind it is not one this product is willing
   * to state, and the contract's schema refuses an empty array. */
  readonly evidence: readonly FindingEvidence[];
}

export interface ListOpenFixesQuery {
  /** From the credential. Never from the request body. No tool input can name an
   * organization. */
  readonly organizationId: string;
  /** `null` means every project in this organization, never every project. */
  readonly projectId: string | null;
  /** At most this many rows. Already bounded to `LIST_OPEN_FIXES_MAX_ITEMS` by the
   * tool's own input schema before it reaches here. */
  readonly limit: number;
}

export interface GetFixQuery {
  readonly organizationId: string;
  readonly fixId: string;
}

export interface GetFindingQuery {
  readonly organizationId: string;
  readonly findingId: string;
}

/**
 * A page of open fixes and the size of the thing it is a page OF.
 *
 * `totalOpen` is counted over everything in scope, not over what was returned. It is
 * what makes `truncated` a fact rather than a guess, and it is why an agent can never
 * infer "I have seen everything" from a short array.
 */
export interface OpenFixPage {
  readonly fixes: readonly OpenFixRow[];
  readonly totalOpen: number;
}

export interface McpReadPort {
  listOpenFixes(query: ListOpenFixesQuery): Promise<OpenFixPage>;
  getFix(query: GetFixQuery): Promise<FixRecord | null>;
  getFinding(query: GetFindingQuery): Promise<FindingRecord | null>;
}

/**
 * What this installation says while there is nowhere for a fix to be recorded.
 *
 * Well-formed, and not pretending. An empty list with a truthful window is a correct
 * answer, `packages/shared/src/mcp/types.ts` says so in as many words: "an empty list
 * is a well-formed answer, not an error … it is the first thing a brand-new
 * installation returns." Zero open fixes is precisely true here: there is no table one
 * could be in. The two id lookups return `null`, which the caller turns into the same
 * `NOT_FOUND` every unknown id gets, so an agent asking for an id it invented and an
 * agent asking on an installation with no findings table get the identical answer,
 * which is also the correct one.
 *
 * It does not crash and it does not fabricate. A thrown error would tell an agent this
 * product is broken; a made-up row would send it to change code on the strength of a
 * number nobody measured. Both are worse than "nothing yet".
 *
 * The absence is said out loud, once per process rather than once per request, the same
 * choice `worker/src/index.ts` makes when it logs the missing delivery composition once
 * per tick. A silent empty answer is indistinguishable from a lane that ran and found
 * nothing, and that is the one distinction worth keeping.
 */
export function createAbsentReadPort(log: (message: string) => void): McpReadPort {
  let announced = false;

  const announceOnce = (): void => {
    if (announced) return;
    announced = true;
    log(
      "mcp: nothing on this installation records findings or fixes yet, so every read answers empty",
    );
  };

  return {
    listOpenFixes(): Promise<OpenFixPage> {
      announceOnce();
      return Promise.resolve({ fixes: [], totalOpen: 0 });
    },
    getFix(): Promise<FixRecord | null> {
      announceOnce();
      return Promise.resolve(null);
    },
    getFinding(): Promise<FindingRecord | null> {
      announceOnce();
      return Promise.resolve(null);
    },
  };
}
