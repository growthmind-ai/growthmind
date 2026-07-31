// The signature ledger's consumer contract (O-006 ADD §2 D-1, D-4, D-8;
// §5 Wave 5) — the FIVE entry points a later outcome's analysis lane,
// delivery scheduler, and Slack responder call, plus the one composition
// that turns a candidate into a signature.
//
// PARAMETER ORDER: every method below takes `projectId` first, matching
// every other repository/service in this package (`listForProject`,
// `findByKey`, `aggregateFor`, …). The ADD's §2 D-4 summary table lists a
// couple of these with `projectId` second; §5 Wave 5's fuller description
// (and this file) puts it first for consistency with the rest of the
// codebase — the ADD's two mentions differ only in argument order, never in
// meaning.
//
// D11 (producer/consumer wiring): each entry point's header names its
// intended caller and the sprint that wires it. The rule this project has
// paid to learn twice — a computed value dropped on the floor because no
// consumer ever reads it — is closed by never hand-passing a value a
// consumer could derive itself: every method here derives what it needs
// from its own arguments (a `CandidateFinding`, a `SignatureHex`, a
// `TenantContext`), never from an out-of-band field a caller forgot to
// thread.
//
// READS MUST BE UNCACHED AND COMMITTED-STATE ONLY (AI-stack layer 2,
// staleness). A stale "not seen" here is a duplicate delivered — there is no
// cache in front of any read in this service, and a later wave must not add
// one without re-litigating this note.
//
// `computeFindingSignature`'s dispatch composes `signatureTuple`
// (`@growthmind/core`, pure) and `sha256Hex` (`../signatures/hex`, this
// package) — the ONE function that turns a candidate into a signature (ADD
// D-1, D11), and the only caller of `sha256Hex` in production code.
//
// Every other method resolves its input signature FORWARD through
// `signature_ancestry` before touching the ledger (ADD D-3(b)) — a stale
// pre-re-key signature (e.g. a Slack interaction payload minted before a
// churn) must land on the live row, never silently stamp a signature nothing
// consults anymore.
//
// ── THE ONE FAIL DIRECTION FOR AN UNRESOLVABLE ANCESTRY WALK (review CR-10) ──
// Stated once, here, because the read path and the write paths must not
// disagree about it — an earlier revision had `consultSignature` SUPPRESS on
// `unresolvable` while `resolveForward` degraded to the unresolved input, so
// a dismissal was stamped onto a signature the read path had just declared
// unknowable.
//
// THE RULE: an unresolvable walk NEVER moves the system toward an extra
// delivery, and NEVER discards a customer's action. Concretely:
//
//   - `consultSignature` (read)              → SUPPRESS / unresolvable_ancestry.
//   - `recordDismissal` (write)              → record against the UNRESOLVED
//                                              input signature.
//   - `markSignatureDelivered` (write)       → stamp the UNRESOLVED input
//                                              signature.
//
// Those are ONE direction, not two: every branch either withholds a delivery
// or records something whose only effect is MORE suppression. Refusing the
// writes was considered and rejected — a throw inside `recordDismissal`
// destroys the customer's "Not useful" click outright (the failure CR-1
// names as the worst available), and it destroys it in exactly the state
// where the ledger is already known to be sick. Recording against the
// unresolved signature loses nothing: a dismissal keyed on that signature
// still suppresses it, and if the ancestry chain is later repaired,
// `recordAncestry`'s carry-forward propagates the dismissal onto the live
// row via `coalesce(...)`. Both unresolvable branches log at `console.error`.
//
// ── THE DISMISSAL IS DURABLE INDEPENDENTLY OF THE LEDGER (review CR-1) ──────
// `dismissals` and `finding_signatures` have two independent producers with
// no ordering guarantee: a Slack "Not useful" click can arrive before the
// analysis lane has ever recorded the signature. `recordDismissal` therefore
// treats the `dismissals` ROW as the durable record of the customer's
// decision and the ledger's `dismissed_at` as a denormalised fast path —
// never the other way round. `consultSignature` reads BOTH, so the
// suppression holds regardless of arrival order.
//
// `recordDismissal` and `recordAncestry` each open exactly one
// `db.transaction(async (tx) => { … })` and write on `tx` directly — never
// through a repository factory constructed over `tx`, because `ScopedDb`
// (`../repositories/types.ts`) is a union of `NodePgDatabase` and
// `PgliteDatabase` that a transaction handle is not assignable to without a
// cast. `../tenancy/ensure-organization.ts:67` is the precedent this copies:
// `db: ScopedDb`, hand-written queries inside the callback, every query
// naming `ctx.organizationId` literally (ADD D-8). Repository factories
// (`createFindingSignaturesRepo`, `createSignatureAncestryRepo`) are used
// everywhere else, where a single read or a single atomic upsert is enough.
import {
  normaliseUrlPath,
  type AncestryReason,
  type DismissalAction,
  type TenantContext,
} from "@growthmind/shared";
import type {
  CandidateFinding,
  FindingClass,
  LedgerRowState,
  SuppressionDecision,
} from "@growthmind/core";
import {
  EVIDENCE_SHAPE_SERIALISERS,
  signatureTuple,
  SIGNATURE_TUPLE_VERSION,
  suppressionDecision,
  SUPPRESSION_POLICY_VERSION,
} from "@growthmind/core";
import { and, eq, sql } from "drizzle-orm";

import { createDismissalsRepo, type DismissalRecord } from "../repositories/dismissals.repo";
import { createProjectsRepo } from "../repositories/projects.repo";
import {
  carryForwardValues,
  CARRY_FORWARD_SET,
  createFindingSignaturesRepo,
  LEDGER_CONFLICT_TARGET,
  type FindingSignatureRecord,
} from "../repositories/finding-signatures.repo";
import {
  createSignatureAncestryRepo,
  type AncestryRecord,
} from "../repositories/signature-ancestry.repo";
import type { ScopedDb } from "../repositories/types";
import { member } from "../schema/auth";
import { dismissals } from "../schema/dismissals";
import { findingSignatures } from "../schema/finding-signatures";
import { signatureAncestry } from "../schema/signature-ancestry";
import { sha256Hex, type SignatureHex } from "../signatures/hex";

/** Everything `computeFindingSignature` reads to compose an identity. Named
 * fields rather than a bare `CandidateFinding`, because the composition also
 * needs `projectId`, which `CandidateFinding` does not carry (it is not a
 * field on the candidate — the caller supplies it from its own
 * `TenantContext`/route param). */
export interface ComputeFindingSignatureInput {
  readonly projectId: string;
  /** `CandidateFinding.surface` — the normalised URL path at MVP. */
  readonly surface: string;
  /** `CandidateFinding.finalClass`. */
  readonly symptomClass: FindingClass;
  /** `CandidateFinding.evidenceShape` — already the serialised string, never
   * re-derived from an `EvidenceShapeInput` here. */
  readonly evidenceShape: string;
}

/**
 * Belt-and-braces refusal (post-sprint audit Finding 4, security):
 * `surface` is persisted PERMANENTLY into `finding_signatures.surface` and
 * hashed into the identity by `computeFindingSignature` below, with NO
 * normalisation check anywhere in `packages/db` before this one.
 * `CandidateFinding.surface` is only `z.string().min(1)` at the schema
 * level; the one existing refusal, `assertNormalisedSurface`
 * (`@growthmind/core`'s `evidence-shape.ts:104-114`), validates the string
 * fed into EVIDENCE SHAPE — a different field on the same candidate — not
 * the `surface` this function receives. A caller can construct a
 * `ComputeFindingSignatureInput` directly (as this file's own tests do) and
 * never touch `evidenceShape()` at all.
 *
 * The stakes here are higher than at that first check: a raw,
 * un-normalised URL path can carry a live password-reset token or an email
 * address (`normaliseUrlPath`'s own H-2 rationale), and here it would be
 * written into an UN-DELETABLE ledger row and baked into a sha256 identity
 * that this sprint's own design never rewrites once minted (D12).
 *
 * FAIL DIRECTION: refuse — but bounded, exactly like `assertNormalisedSurface`:
 * the check is IDEMPOTENCE (re-normalising is a no-op), not a pattern list,
 * so an already-normalised path never trips it.
 *
 * The refusal message names ONLY the expected format and echoes NEITHER
 * the raw value NOR its normalised form — stricter than
 * `evidence-shape.ts:108-113`'s own message, which names the normalised
 * result. Deliberate: echoing anything derived from the offending value is
 * exactly how a token or an email address reaches a log line, and this is
 * the last gate before the value is hashed into a permanent record.
 */
function assertNormalisedSurfaceForSignature(surface: string): void {
  if (normaliseUrlPath(surface, null) === surface) {
    return;
  }

  throw new Error(
    "computeFindingSignature refuses a surface that is not already a normaliseUrlPath fixed point: " +
      "a surface must equal its own normalised form (packages/shared's normaliseUrlPath) before it " +
      "can enter a finding's permanent identity.",
  );
}

/**
 * The ONE function that turns a candidate into a signature (ADD D-1, D11,
 * FR-I(e)) — the only caller of `sha256Hex` in production code.
 *
 * `signatureTuple` (pure, `@growthmind/core`) produces the canonical tuple
 * string; `sha256Hex` (this package, `../signatures/hex`) hashes it.
 */
export function computeFindingSignature(
  input: ComputeFindingSignatureInput,
  version: number = SIGNATURE_TUPLE_VERSION,
): SignatureHex {
  assertNormalisedSurfaceForSignature(input.surface);

  return sha256Hex(
    signatureTuple(
      {
        projectId: input.projectId,
        surfaceId: input.surface,
        symptomClass: input.symptomClass,
        evidenceShape: input.evidenceShape,
      },
      version,
    ),
  );
}

/** `recordSignature`'s result: the signature it computed AND the ledger row
 * `upsertSeen` wrote/updated for it. */
export interface RecordSignatureResult {
  readonly signature: SignatureHex;
  readonly record: FindingSignatureRecord;
}

export interface RecordDismissalInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly signature: SignatureHex;
  readonly action: DismissalAction;
  /** `null` for a system/backfill path with no attributable member — never
   * an unmapped Slack user id (that refusal is a later outcome's Slack
   * boundary concern, see `dismissals.ts`'s table header). */
  readonly dismissedByUserId: string | null;
}

export interface RecordAncestryInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
  readonly reason: AncestryReason;
}

export interface SignatureLedgerService {
  /**
   * Caller: the analysis lane, on every candidate (a later outcome).
   * Computes the signature from `candidate` via `computeFindingSignature`
   * (the only producer, FR-I(e)), then `upsertSeen`s the ledger row.
   *
   * THROWS when `projectId` does not belong to `ctx.organizationId` (security
   * audit M-2) — see `assertProjectInOrg` for why every write entry point
   * rejects loudly rather than returning something success-shaped.
   */
  recordSignature(projectId: string, candidate: CandidateFinding): Promise<RecordSignatureResult>;
  /**
   * Caller: the delivery scheduler, before delivery (a later outcome).
   * Accepts EITHER a fresh `CandidateFinding` or a bare `SignatureHex` — the
   * latter is the stale-inbound case (D-3(b)): a caller holding a
   * pre-re-key signature (e.g. a Slack interaction payload minted before an
   * ancestry churn). Flow: compute-or-accept the signature → resolve it
   * forward through `signature_ancestry` → on an unresolvable walk, decide
   * `unresolvable_ancestry` (suppress-on-doubt, ADD D-2) → otherwise look up
   * the resolved signature's ledger row and hand it to
   * `suppressionDecision`. An unregistered `evidenceShapeVersion` surfaces as
   * `unknown_shape_version` (also suppress-on-doubt) rather than throwing to
   * the caller — the one catch boundary this service owns, logged with the
   * version only, never the surface value.
   */
  consultSignature(
    projectId: string,
    input: CandidateFinding | SignatureHex,
  ): Promise<SuppressionDecision>;
  /**
   * Caller: the delivery scheduler, AFTER a successful post (a later
   * outcome). Resolves `signature` forward, then stamps `delivered_at` via
   * `markDelivered` — `coalesce(delivered_at, $at)`, so a delivery replay
   * never moves the first-delivery instant (D4). Without this entry point,
   * `delivered_at` would be a column no write path ever stamps and
   * `already_delivered` would be unreachable in production (ADD D-4's
   * rationale for shipping five entry points, not three).
   *
   * THROWS on a foreign `projectId` (M-2). Its `null` return means "no such
   * ledger row" and never "wrong tenant" — the two must not collapse.
   */
  markSignatureDelivered(
    projectId: string,
    signature: SignatureHex,
  ): Promise<FindingSignatureRecord | null>;
  /**
   * Caller: the Slack "Not useful" button (a later outcome). Resolves
   * `signature` forward, then — in ONE transaction (ADD D-8) —
   * `insert(dismissals).onConflictDoNothing(...)`, reads back the row, and
   * stamps `dismissed_at = coalesce(dismissed_at, $now)` on the ledger row.
   * Idempotent: a second identical call returns the same result with one
   * row and no error (D4/D6).
   *
   * THROWS, before the transaction opens, on a foreign `projectId` (M-2) or a
   * non-`null` `dismissedByUserId` that is not a member of
   * `ctx.organizationId` (M-1 — a forged author on a permanent, org-wide
   * suppression is rejected, never silently nulled).
   */
  recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord>;
  /**
   * Caller: a later outcome's surface-derivation swap; version-bump
   * migrations. In ONE transaction (ADD D-3a, D-8): inserts the
   * `signature_ancestry` edge `(org, project, old, new, reason)`, then
   * carries the old ledger row's state forward onto the new signature via
   * `carryForwardValues`/`CARRY_FORWARD_SET` (`../repositories/finding-signatures.repo.ts`,
   * review CR-12 — the ONE shared definition of carry-forward, also used by
   * `FindingSignaturesRepo.carryForward`) — this is D12's own named remedy:
   * a dismissal survives a re-key because the ledger row carried it, not
   * because a read path searched for it.
   *
   * IDEMPOTENT on retry (post-sprint audit Finding 2, D4/D6): the edge
   * insert is guarded by `onConflictDoNothing` on the same unique index
   * `(organization_id, old_signature)`; a retry reads back the existing
   * edge and returns it WITHOUT repeating the carry-forward step, because
   * `times_seen = existing + old.times_seen` would double-count on a second
   * application.
   *
   * THROWS, before the transaction opens, on a foreign `projectId` (M-2).
   */
  recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord>;
}

/** `computeFindingSignature` needs `projectId` (which `CandidateFinding`
 * does not carry) plus the four tuple inputs the candidate DOES carry.
 * Local to this factory — never exported — so there is exactly one place
 * a `CandidateFinding` is read down to a `ComputeFindingSignatureInput`. */
function toComputeInput(
  projectId: string,
  candidate: CandidateFinding,
): ComputeFindingSignatureInput {
  return {
    projectId,
    surface: candidate.surface,
    symptomClass: candidate.finalClass,
    evidenceShape: candidate.evidenceShape,
  };
}

export function createSignatureLedgerService(
  db: ScopedDb,
  ctx: TenantContext,
): SignatureLedgerService {
  const ledgerRepo = createFindingSignaturesRepo(db, ctx);
  const ancestryRepo = createSignatureAncestryRepo(db, ctx);
  const dismissalsRepo = createDismissalsRepo(db, ctx);
  const projectsRepo = createProjectsRepo(db, ctx);

  /**
   * THE TENANCY GUARD FOR EVERY WRITE (O-006 security audit M-2).
   *
   * `projectId` is caller-supplied on every entry point, and `projects.id` is
   * FK-enforced but NOT org-enforced — so without this check org A could write
   * ledger / dismissal / ancestry rows naming org B's project. Confidentiality
   * survived that (every read filters org first), but INTEGRITY did not: all
   * three FKs are `ON DELETE cascade`, so deleting org B's project would
   * cascade-delete org A's ledger rows and silently un-suppress every
   * permanent dismissal recorded under that project id — precisely the
   * guarantee this sprint exists to hold (D12).
   *
   * ONE place, called before any write touches the database.
   * `projectsRepo.findById` is already org-filtered and returns `null` for a
   * foreign org's project (D-B), so this needs no org-id parameter of its own.
   *
   * FAIL DIRECTION — THROW, never a silent no-op. `poll-runs.repo.ts:157-176`
   * returns `null` for a foreign org's row because it CAN: `null` is inside
   * its return type and reads as "not yours". These are write entry points
   * whose return types (`RecordSignatureResult`, `DismissalRecord`,
   * `AncestryRecord`) cannot express "refused", and a refusal that returns
   * something success-shaped is the worst outcome available — a caller would
   * record a dismissal that suppresses nothing and never learn. Throwing is
   * the only fail direction that cannot be mistaken for success.
   * `markSignatureDelivered` throws too, for one consistent rule: its `null`
   * already means "no such ledger row", not "wrong tenant".
   */
  async function assertProjectInOrg(projectId: string): Promise<void> {
    const project = await projectsRepo.findById(projectId);
    if (!project) {
      throw new Error("signature-ledger: project does not belong to the caller's organization");
    }
  }

  /**
   * M-1's guard. `dismissals.dismissed_by_user_id` FKs `user.id` GLOBALLY, so
   * without this an arbitrary user id — including one in another org — could
   * be stamped as the author of a permanent, org-wide suppression. That makes
   * the audit trail on org A's own permanent record forgeable, and it is the
   * exact column a future undo/appeal flow (OQ-2) would key on.
   *
   * FAIL DIRECTION — REJECT (throw), not "null the attribution". Nulling would
   * silently rewrite the caller's claim into the documented system/backfill
   * shape, making a forgery attempt indistinguishable from a legitimate
   * unattributed dismissal in the very audit trail this protects. A caller
   * that genuinely has no attributable member passes `null` explicitly, which
   * is accepted here and skips the lookup.
   */
  async function assertDismissedByIsMember(userId: string | null): Promise<void> {
    if (userId === null) {
      return;
    }

    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, ctx.organizationId), eq(member.userId, userId)));

    if (!row) {
      throw new Error(
        "signature-ledger: dismissedByUserId is not a member of the caller's organization",
      );
    }
  }

  /**
   * Resolves `signature` FORWARD through `signature_ancestry` (ADD D-3(b))
   * for the WRITE paths: a caller holding a stale pre-re-key signature must
   * land on the live row.
   *
   * An unresolvable walk (a cycle or the hop cap) has no "live" answer, so it
   * degrades to the ORIGINAL input signature — logged, never thrown. That is
   * the write half of this file's ONE declared fail direction (see the header,
   * review CR-10): the read path suppresses, the write paths record against
   * the unresolved signature, and both branches only ever withhold a delivery
   * or add suppression. Refusing here would throw away the customer's
   * dismissal, which is strictly worse.
   */
  async function resolveForward(signature: SignatureHex): Promise<SignatureHex> {
    const resolution = await ancestryRepo.resolve(signature);
    if (resolution.resolution === "resolved") {
      return resolution.signature;
    }

    console.error(
      "signature-ledger: ancestry walk unresolvable — operating on the unresolved input signature",
      { cause: resolution.cause },
    );
    return signature;
  }

  return {
    async recordSignature(
      projectId: string,
      candidate: CandidateFinding,
    ): Promise<RecordSignatureResult> {
      await assertProjectInOrg(projectId);

      // `recordSignature` is the ONLY producer of a signature (FR-I(e)) —
      // every other entry point either accepts one already computed or
      // resolves one forward, never re-derives it.
      const signature = computeFindingSignature(toComputeInput(projectId, candidate));

      const record = await ledgerRepo.upsertSeen({
        projectId,
        signature,
        symptomClass: candidate.finalClass,
        surface: candidate.surface,
        signatureTupleVersion: SIGNATURE_TUPLE_VERSION,
        evidenceShapeVersion: candidate.evidenceShapeVersion,
        surfaceNormalisationVersion: candidate.surfaceNormalisationVersion,
        seenAt: new Date(),
      });

      return { signature, record };
    },

    async consultSignature(
      projectId: string,
      input: CandidateFinding | SignatureHex,
    ): Promise<SuppressionDecision> {
      // NO `assertProjectInOrg` HERE — deliberate (M-2). This is the one
      // READ entry point: it writes nothing, and `ledgerRepo.findBySignature`
      // already filters on `ctx.organizationId` first, so a foreign project id
      // finds no row and falls through to the ordinary "never seen" decision.
      // A guard here would be defence-in-depth, not a correctness fix, and it
      // would cost every consult an extra round trip on the delivery hot path
      // while CHANGING the fail direction for a legitimate caller from
      // "deliver, never seen" to a thrown error. The integrity hazard M-2
      // names — cascade-deleting another org's ledger rows — is reachable only
      // through a write, and every write is guarded above.
      //
      // A bare `SignatureHex` is a `string`; a `CandidateFinding` is not —
      // that alone discriminates the union with no brand check needed.
      const isCandidate = typeof input !== "string";

      if (isCandidate) {
        // The one catch boundary this service owns (ADD D-10, D5/D8): an
        // `evidenceShapeVersion` this build has no registered serialiser for
        // surfaces as a named suppression, never a thrown error to the
        // caller. Checked BEFORE computing a signature — computing one
        // would succeed regardless (the candidate's `evidenceShape` is
        // already a serialised string), which is exactly why the version
        // must be checked explicitly rather than discovered as a side
        // effect of some other call throwing.
        if (!EVIDENCE_SHAPE_SERIALISERS.has(input.evidenceShapeVersion)) {
          // Logged with the VERSION ONLY — never the candidate's surface,
          // which can carry a live reset token or an email address
          // (evidence-shape.ts's own redaction rule, restated for this
          // service's one catch boundary).
          console.error("signature-ledger: unknown evidence_shape version — suppressing on doubt", {
            evidenceShapeVersion: input.evidenceShapeVersion,
          });
          return suppressionDecision(
            { resolution: "unknown_shape_version" },
            SUPPRESSION_POLICY_VERSION,
          );
        }
      }

      const signature = isCandidate
        ? computeFindingSignature(toComputeInput(projectId, input))
        : input;

      const resolution = await ancestryRepo.resolve(signature);
      if (resolution.resolution === "unresolvable") {
        console.error("signature-ledger: ancestry walk unresolvable — suppressing on doubt", {
          cause: resolution.cause,
        });
        return suppressionDecision(
          { resolution: "unresolvable_ancestry" },
          SUPPRESSION_POLICY_VERSION,
        );
      }

      const row = await ledgerRepo.findBySignature(projectId, resolution.signature);
      let rowState: LedgerRowState | null = row
        ? { deliveredAt: row.deliveredAt, dismissedAt: row.dismissedAt }
        : null;

      // ── "DISMISSED FOREVER" DOES NOT DEPEND ON THE LEDGER ROW (CR-1, CR-2) ──
      // `dismissals` and `finding_signatures` have two independent producers
      // with no ordering guarantee (a Slack "Not useful" click vs. the
      // analysis lane), so the ledger row can be missing, or present with a
      // null `dismissed_at`, at the moment a dismissal already exists. Reading
      // ONLY `finding_signatures.dismissed_at` here made the permanent
      // suppression silently fail in exactly that window. The `dismissals`
      // row is the durable record; the ledger stamp is the fast path.
      //
      // Cost is bounded: this second read runs ONLY when the ledger has not
      // already answered "dismissed", so the steady state (dismissal stamped,
      // ledger row present) still costs one query on the delivery hot path.
      // `findLatestForSignature` is org- AND project-filtered (CR-13), so it
      // widens nothing a foreign project id could not already reach.
      if (rowState === null || rowState.dismissedAt === null) {
        const dismissal = await dismissalsRepo.findLatestForSignature(
          projectId,
          resolution.signature,
        );
        if (dismissal) {
          rowState = {
            deliveredAt: rowState?.deliveredAt ?? null,
            dismissedAt: dismissal.dismissedAt,
          };
        }
      }

      return suppressionDecision(
        { resolution: "resolved", row: rowState },
        SUPPRESSION_POLICY_VERSION,
      );
    },

    async markSignatureDelivered(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      await assertProjectInOrg(projectId);

      const resolved = await resolveForward(signature);
      return ledgerRepo.markDelivered(projectId, resolved, new Date());
    },

    async recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord> {
      // BEFORE the transaction opens (M-2, M-1): the transaction below can
      // never commit with an unvalidated project or a forged author, because
      // neither guard's failure path reaches `db.transaction` at all.
      await assertProjectInOrg(input.projectId);
      await assertDismissedByIsMember(input.dismissedByUserId);

      const resolvedSignature = await resolveForward(input.signature);
      const now = new Date();

      // ONE transaction (ADD D-8): the dismissal insert and the ledger's
      // `dismissed_at` stamp succeed together or not at all — a partial
      // write would leave a dismissal that suppresses nothing. Written on
      // `tx` directly (see this file's header) — never through a repository
      // factory, which `ScopedDb` cannot accept a transaction handle for
      // without a cast.
      return db.transaction(async (tx) => {
        // `onConflictDoNothing` keyed on the same tuple the unique index
        // conflicts on: a second identical dismissal is a no-op insert, not
        // an error (D4/D6 idempotence).
        await tx
          .insert(dismissals)
          .values({
            organizationId: ctx.organizationId,
            projectId: input.projectId,
            findingId: input.findingId,
            signature: resolvedSignature,
            action: input.action,
            dismissedByUserId: input.dismissedByUserId,
            dismissedAt: now,
          })
          .onConflictDoNothing({
            target: [dismissals.organizationId, dismissals.findingId, dismissals.action],
          });

        const [dismissalRow] = await tx
          .select()
          .from(dismissals)
          .where(
            and(
              eq(dismissals.organizationId, ctx.organizationId),
              eq(dismissals.findingId, input.findingId),
              eq(dismissals.action, input.action),
            ),
          );

        if (!dismissalRow) {
          throw new Error(
            "signature-ledger.recordDismissal: dismissal insert/read-back returned no row",
          );
        }

        // `dismissed_at = coalesce(dismissed_at, $now)` — permanent once
        // set; a replay never moves the original instant (D-8, D4).
        //
        // THE ROW COUNT IS CHECKED (review CR-1). This UPDATE legitimately
        // matches ZERO rows when the dismissal arrives before the analysis
        // lane ever recorded the signature — two independent producers, no
        // ordering guarantee. It used to return success regardless, and the
        // permanent suppression evaporated the moment `recordSignature`
        // later inserted a fresh row with `dismissed_at = NULL`.
        //
        // WHY NOT AN UPSERT HERE: `finding_signatures` requires
        // `symptom_class`, `surface`, `signature_tuple_version`, and
        // `evidence_shape_version` NOT NULL, and a dismissal carries none of
        // them. Inserting a ledger row from this path would have to fabricate
        // that provenance — and `upsertSeen`'s conflict-update deliberately
        // does NOT overwrite those columns (D-9), so the fabricated values
        // would be permanent and unrepairable. A row that lies about what a
        // finding IS, forever, is worse than an absent one.
        //
        // WHY NOT THROW: the `dismissals` insert above is the durable record
        // of the customer's decision, and `consultSignature` reads it as a
        // fallback — so the suppression HOLDS without this stamp. Throwing
        // would roll back a dismissal that is already correct.
        const stamped = await tx
          .update(findingSignatures)
          .set({ dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, ${now})` })
          .where(
            and(
              eq(findingSignatures.organizationId, ctx.organizationId),
              eq(findingSignatures.projectId, input.projectId),
              eq(findingSignatures.signature, resolvedSignature),
            ),
          )
          .returning();

        if (stamped.length === 0) {
          console.error(
            "signature-ledger: dismissal recorded before any ledger row exists for this signature — " +
              "suppression is held by the dismissals row, which consultSignature reads as a fallback",
            { findingId: input.findingId, action: input.action },
          );
        }

        return dismissalRow;
      });
    },

    async recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord> {
      // BEFORE the transaction opens (M-2) — same reasoning as
      // `recordDismissal`: a rejected project never reaches `db.transaction`,
      // so no transaction can commit with an unvalidated project.
      await assertProjectInOrg(input.projectId);

      // ONE transaction (ADD D-3a, D-8): the edge insert and the
      // carry-forward upsert succeed together or not at all. The
      // carry-forward half runs on `tx` here, sharing the ONE definition of
      // its values/conflict-update with `finding-signatures.repo.ts`'s
      // `carryForward` (review CR-12) — rather than calling the repository
      // method itself, which is constructed over `db`, not `tx`, and could
      // not share this transaction.
      return db.transaction(async (tx) => {
        // IDEMPOTENT ON RETRY (post-sprint audit Finding 2, D4/D6): guarded
        // by `onConflictDoNothing` on the same unique index the schema
        // already enforces, `(organization_id, old_signature)`. Every OTHER
        // write path in this service degrades cleanly on replay
        // (`upsertSeen`, `markDelivered`, `recordDismissal`); this insert
        // used to have no guard at all and raised a raw Postgres unique
        // violation on a second identical call.
        const [insertedEdge] = await tx
          .insert(signatureAncestry)
          .values({
            organizationId: ctx.organizationId,
            projectId: input.projectId,
            oldSignature: input.oldSignature,
            newSignature: input.newSignature,
            reason: input.reason,
          })
          .onConflictDoNothing({
            target: [signatureAncestry.organizationId, signatureAncestry.oldSignature],
          })
          .returning();

        if (!insertedEdge) {
          // CONFLICT: this old_signature already has a forward edge under
          // this org — a RETRY of this exact call, not a new mapping. The
          // carry-forward below already ran on the ORIGINAL call; it must
          // NOT run again here, because `times_seen = existing +
          // old.times_seen` (`CARRY_FORWARD_SET`) is not idempotent under a
          // second application — running it twice would double-count the
          // ledger. Read back the existing edge and return it unchanged,
          // mirroring `recordDismissal`'s own
          // onConflictDoNothing-then-read-back idempotence.
          const [existingEdge] = await tx
            .select()
            .from(signatureAncestry)
            .where(
              and(
                eq(signatureAncestry.organizationId, ctx.organizationId),
                eq(signatureAncestry.oldSignature, input.oldSignature),
              ),
            );

          if (!existingEdge) {
            throw new Error(
              "signature-ledger.recordAncestry: insert conflicted but no existing edge was found on read-back",
            );
          }

          return existingEdge;
        }

        const edge = insertedEdge;

        // The OLD signature may never have been recorded (e.g. a
        // version-bump migration ancestry edge drawn before any candidate
        // under the old identity was ever seen in THIS org/project scope) —
        // that is a legitimate degenerate case, not an error: there is
        // nothing to carry forward, so the edge stands alone and the new
        // signature starts its own ledger history the ordinary way, via
        // `recordSignature`, the next time it is seen.
        const [oldRow] = await tx
          .select()
          .from(findingSignatures)
          .where(
            and(
              eq(findingSignatures.organizationId, ctx.organizationId),
              eq(findingSignatures.projectId, input.projectId),
              eq(findingSignatures.signature, input.oldSignature),
            ),
          );

        if (oldRow) {
          // Upsert onto the NEW signature — the old row is never touched,
          // staying in place as the audit trail (D-3a point 3). The values
          // and the conflict-update come from the ONE shared definition in
          // `finding-signatures.repo.ts` (review CR-12): only the query
          // BUILDER differs between here (`tx`) and the repository (`db`),
          // never the semantics.
          const [carried] = await tx
            .insert(findingSignatures)
            .values({
              organizationId: ctx.organizationId,
              ...carryForwardValues({
                projectId: input.projectId,
                newSignature: input.newSignature,
                oldRow,
              }),
            })
            .onConflictDoUpdate({
              target: LEDGER_CONFLICT_TARGET,
              set: CARRY_FORWARD_SET,
            })
            .returning();

          if (!carried) {
            throw new Error(
              "signature-ledger.recordAncestry: carry-forward upsert returned no row",
            );
          }
        }

        return edge;
      });
    },
  };
}
