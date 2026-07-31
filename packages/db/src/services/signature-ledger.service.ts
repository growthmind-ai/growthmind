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
// Implemented (Wave 5) against this scaffold's final signatures.
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
import type { AncestryReason, DismissalAction, TenantContext } from "@growthmind/shared";
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

import type { DismissalRecord } from "../repositories/dismissals.repo";
import {
  createFindingSignaturesRepo,
  type FindingSignatureRecord,
} from "../repositories/finding-signatures.repo";
import {
  createSignatureAncestryRepo,
  type AncestryRecord,
} from "../repositories/signature-ancestry.repo";
import type { ScopedDb } from "../repositories/types";
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
   */
  markSignatureDelivered(projectId: string, signature: SignatureHex): Promise<FindingSignatureRecord | null>;
  /**
   * Caller: the Slack "Not useful" button (a later outcome). Resolves
   * `signature` forward, then — in ONE transaction (ADD D-8) —
   * `insert(dismissals).onConflictDoNothing(...)`, reads back the row, and
   * stamps `dismissed_at = coalesce(dismissed_at, $now)` on the ledger row.
   * Idempotent: a second identical call returns the same result with one
   * row and no error (D4/D6).
   */
  recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord>;
  /**
   * Caller: a later outcome's surface-derivation swap; version-bump
   * migrations. In ONE transaction (ADD D-3a, D-8): inserts the
   * `signature_ancestry` edge `(org, project, old, new, reason)`, then
   * carries the old ledger row's state forward onto the new signature
   * (`carryForward`) — this is D12's own named remedy: a dismissal survives
   * a re-key because the ledger row carried it, not because a read path
   * searched for it.
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

  /**
   * Resolves `signature` FORWARD through `signature_ancestry` (ADD D-3(b)):
   * a caller holding a stale pre-re-key signature must land on the live
   * row. An unresolvable walk (a cycle or the hop cap) has no "live" answer
   * to fall back to, so it degrades to the ORIGINAL input signature —
   * logged, never thrown — leaving the caller to operate on the signature
   * it was given rather than silently substituting a different one.
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
          console.error(
            "signature-ledger: unknown evidence_shape version — suppressing on doubt",
            { evidenceShapeVersion: input.evidenceShapeVersion },
          );
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
        console.error(
          "signature-ledger: ancestry walk unresolvable — suppressing on doubt",
          { cause: resolution.cause },
        );
        return suppressionDecision(
          { resolution: "unresolvable_ancestry" },
          SUPPRESSION_POLICY_VERSION,
        );
      }

      const row = await ledgerRepo.findBySignature(projectId, resolution.signature);
      const rowState: LedgerRowState | null = row
        ? { deliveredAt: row.deliveredAt, dismissedAt: row.dismissedAt }
        : null;

      return suppressionDecision({ resolution: "resolved", row: rowState }, SUPPRESSION_POLICY_VERSION);
    },

    async markSignatureDelivered(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      const resolved = await resolveForward(signature);
      return ledgerRepo.markDelivered(projectId, resolved, new Date());
    },

    async recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord> {
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
        await tx
          .update(findingSignatures)
          .set({ dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, ${now})` })
          .where(
            and(
              eq(findingSignatures.organizationId, ctx.organizationId),
              eq(findingSignatures.projectId, input.projectId),
              eq(findingSignatures.signature, resolvedSignature),
            ),
          );

        return dismissalRow;
      });
    },

    async recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord> {
      // ONE transaction (ADD D-3a, D-8): the edge insert and the
      // carry-forward upsert succeed together or not at all. The
      // carry-forward half is hand-written here on `tx` — mirroring
      // `finding-signatures.repo.ts`'s `carryForward` exactly — rather than
      // calling the repository method, which is constructed over `db`, not
      // `tx`, and could not share this transaction.
      return db.transaction(async (tx) => {
        const [edge] = await tx
          .insert(signatureAncestry)
          .values({
            organizationId: ctx.organizationId,
            projectId: input.projectId,
            oldSignature: input.oldSignature,
            newSignature: input.newSignature,
            reason: input.reason,
          })
          .returning();

        if (!edge) {
          throw new Error(
            "signature-ledger.recordAncestry: ancestry edge insert returned no row",
          );
        }

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
          // staying in place as the audit trail (D-3a point 3).
          const [carried] = await tx
            .insert(findingSignatures)
            .values({
              organizationId: ctx.organizationId,
              projectId: input.projectId,
              signature: input.newSignature,
              symptomClass: oldRow.symptomClass,
              surface: oldRow.surface,
              signatureTupleVersion: oldRow.signatureTupleVersion,
              evidenceShapeVersion: oldRow.evidenceShapeVersion,
              surfaceNormalisationVersion: oldRow.surfaceNormalisationVersion,
              firstSeenAt: oldRow.firstSeenAt,
              lastSeenAt: oldRow.lastSeenAt,
              timesSeen: oldRow.timesSeen,
              deliveredAt: oldRow.deliveredAt,
              dismissedAt: oldRow.dismissedAt,
            })
            .onConflictDoUpdate({
              target: [
                findingSignatures.organizationId,
                findingSignatures.projectId,
                findingSignatures.signature,
              ],
              set: {
                firstSeenAt: sql`least(${findingSignatures.firstSeenAt}, excluded.first_seen_at)`,
                lastSeenAt: sql`greatest(${findingSignatures.lastSeenAt}, excluded.last_seen_at)`,
                timesSeen: sql`${findingSignatures.timesSeen} + excluded.times_seen`,
                deliveredAt: sql`coalesce(${findingSignatures.deliveredAt}, excluded.delivered_at)`,
                dismissedAt: sql`coalesce(${findingSignatures.dismissedAt}, excluded.dismissed_at)`,
              },
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
