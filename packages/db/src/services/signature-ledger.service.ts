// The signature ledger's consumer contract: five entry points (analysis lane, delivery
// scheduler, Slack responder) plus `computeFindingSignature`, the one composition that
// turns a candidate into a signature. Every entry point resolves its input signature
// forward through `signature_ancestry` first, and an unresolvable walk only ever
// withholds a delivery or adds suppression, never the reverse. Reads are uncached.
// Design rationale: docs/decisions/0012-signature-ledger.md
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

/** Everything `computeFindingSignature` reads to compose an identity. Named fields
 * rather than a bare `CandidateFinding`, because the composition also needs
 * `projectId`, which `CandidateFinding` does not carry (it is not a field on the
 * candidate. The caller supplies it from its own `TenantContext`/route param). */
export interface ComputeFindingSignatureInput {
  readonly projectId: string;
  /** `CandidateFinding.surface`, the normalised URL path at MVP. */
  readonly surface: string;
  /** `CandidateFinding.finalClass`. */
  readonly symptomClass: FindingClass;
  /** `CandidateFinding.evidenceShape`, already the serialised string, never re-derived
   * from an `EvidenceShapeInput` here. */
  readonly evidenceShape: string;
}

/**
 * Belt-and-braces refusal (post-sprint audit Finding 4, security): `surface` is
 * persisted permanently into `finding_signatures.surface` and hashed into the identity
 * by `computeFindingSignature` below, with NO normalisation check anywhere in
 * `packages/db` before this one. `CandidateFinding.surface` is only `z.string.min`
 * at the schema level; the one existing refusal, `assertNormalisedSurface`
 * (`@growthmind/core`'s `evidence-shape.ts:104-114`), validates the string fed into
 * evidence shape (a different field on the same candidate) not the `surface` this
 * function receives. A caller can construct a `ComputeFindingSignatureInput` directly
 * (as this file's own tests do) and never touch `evidenceShape` at all.
 *
 * The stakes here are higher than at that first check: a raw, un-normalised URL path
 * can carry a live password-reset token or an email address (`normaliseUrlPath`'s own
 *  rationale), and here it would be written into an un-deletable ledger row and
 * baked into a sha256 identity that this sprint's own design never rewrites once
 * minted.
 *
 * Fail direction: refuse, but bounded, exactly like `assertNormalisedSurface`: the
 * check is idempotence (re-normalising is a no-op), not a pattern list, so an
 * already-normalised path never trips it.
 *
 * The refusal message names only the expected format and echoes neither the raw value
 * nor its normalised form. Stricter than `evidence-shape.ts:108-113`'s own message,
 * which names the normalised result. Deliberate: echoing anything derived from the
 * offending value is exactly how a token or an email address reaches a log line, and
 * this is the last gate before the value is hashed into a permanent record.
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
 * The one function that turns a candidate into a signature. The only caller
 * of `sha256Hex` in production code.
 *
 * `signatureTuple` (pure, `@growthmind/core`) produces the canonical tuple string;
 * `sha256Hex` (this package, `../signatures/hex`) hashes it.
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

/** `recordSignature`'s result: the signature it computed and the ledger row
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
  /** `null` for a system/backfill path with no attributable member, never an unmapped
   * Slack user id (that refusal is a later outcome's Slack boundary concern, see
   * `dismissals.ts`'s table header). */
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
   * Caller: the analysis lane, on every candidate (a later outcome). Computes the
   * signature from `candidate` via `computeFindingSignature` (the only
   * producer), then `upsertSeen`s the ledger row.
   *
   * Throws when `projectId` does not belong to `ctx.organizationId` (security audit).
   * See `assertProjectInOrg` for why every write entry point rejects loudly
   * rather than returning something success-shaped.
   */
  recordSignature(projectId: string, candidate: CandidateFinding): Promise<RecordSignatureResult>;
  /**
   * Caller: the delivery scheduler, before delivery (a later outcome). Accepts either a
   * fresh `CandidateFinding` or a bare `SignatureHex`. The latter is the stale-inbound
   * case: a caller holding a pre-re-key signature (e.g. a Slack interaction
   * payload minted before an ancestry churn). Flow: compute-or-accept the signature →
   * resolve it forward through `signature_ancestry` → on an unresolvable walk, decide
   * `unresolvable_ancestry` (suppress-on-doubt) → otherwise look up the resolved
   * signature's ledger row and hand it to `suppressionDecision`. An unregistered
   * `evidenceShapeVersion` surfaces as `unknown_shape_version` (also suppress-on-doubt)
   * rather than throwing to the caller. The one catch boundary this service owns,
   * logged with the version only, never the surface value.
   */
  consultSignature(
    projectId: string,
    input: CandidateFinding | SignatureHex,
  ): Promise<SuppressionDecision>;
  /**
   * Caller: the delivery scheduler, after a successful post (a later outcome). Resolves
   * `signature` forward, then stamps `delivered_at` via `markDelivered`,
   * `coalesce(delivered_at, $at)`, so a delivery replay never moves the first-delivery
   * instant. Without this entry point, `delivered_at` would be a column no write path
   * ever stamps and `already_delivered` would be unreachable in production (add the
   * rationale for shipping five entry points, not three).
   *
   * Throws on a foreign `projectId`. Its `null` return means "no such ledger row"
   * and never "wrong tenant". The two must not collapse.
   */
  markSignatureDelivered(
    projectId: string,
    signature: SignatureHex,
  ): Promise<FindingSignatureRecord | null>;
  /**
   * Caller: the Slack "Not useful" button (a later outcome). Resolves `signature`
   * forward, then (in one transaction) `insert(dismissals).onConflictDoNothing`,
   * reads back the row, and stamps `dismissed_at = coalesce(dismissed_at, $now)` on the
   * ledger row. Idempotent: a second identical call returns the same result with one
   * row and no error.
   *
   * Throws, before the transaction opens, on a foreign `projectId` or a
   * non-`null` `dismissedByUserId` that is not a member of `ctx.organizationId` (. A
   * forged author on a permanent, org-wide suppression is rejected, never silently
   * nulled).
   */
  recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord>;
  /**
   * Caller: a later outcome's surface-derivation swap; version-bump migrations. In one
   * transaction: inserts the `signature_ancestry` edge `(org, project, old, new,
   * reason)`, then carries the old ledger row's state forward onto the new signature
   * via `carryForwardValues`/`CARRY_FORWARD_SET`
   * (`../repositories/finding-signatures.repo.ts`, review. The one shared definition of
   * carry-forward, also used by `FindingSignaturesRepo.carryForward`). This is the own
   * named remedy: a dismissal survives a re-key because the ledger row carried it, not
   * because a read path searched for it.
   *
   * Idempotent on retry (post-sprint audit finding 2): the edge insert is guarded by
   * `onConflictDoNothing` on the same unique index `(organization_id, old_signature)`;
   * a retry reads back the existing edge and returns it without repeating the
   * carry-forward step, because `times_seen = existing + old.times_seen` would
   * double-count on a second application.
   *
   * Throws, before the transaction opens, on a foreign `projectId`.
   */
  recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord>;
}

/** `computeFindingSignature` needs `projectId` (which `CandidateFinding` does not
 * carry) plus the four tuple inputs the candidate does carry. Local to this factory
 * (never exported) so there is exactly one place a `CandidateFinding` is read down to a
 * `ComputeFindingSignatureInput`. */
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
   * The tenancy guard for every write (security audit).
   *
   * `projectId` is caller-supplied on every entry point, and `projects.id` is
   * FK-enforced but not org-enforced, so without this check org A could write ledger /
   * dismissal / ancestry rows naming org B's project. Confidentiality survived that
   * (every read filters org first), but integrity did not: all three FKs are `ON DELETE
   * cascade`, so deleting org B's project would cascade-delete org A's ledger rows and
   * silently un-suppress every permanent dismissal recorded under that project id.
   * Precisely the guarantee this sprint exists to hold.
   *
   * One place, called before any write touches the database. `projectsRepo.findById` is
   * already org-filtered and returns `null` for a foreign org's project, so this needs
   * no org-id parameter of its own.
   *
   * Fail direction, throw, never a silent no-op. `poll-runs.repo.ts:157-176` returns
   * `null` for a foreign org's row because it can: `null` is inside its return type and
   * reads as "not yours". These are write entry points whose return types
   * (`RecordSignatureResult`, `DismissalRecord`, `AncestryRecord`) cannot express
   * "refused", and a refusal that returns something success-shaped is the worst outcome
   * available. A caller would record a dismissal that suppresses nothing and never
   * learn. Throwing is the only fail direction that cannot be mistaken for success.
   * `markSignatureDelivered` throws too, for one consistent rule: its `null` already
   * means "no such ledger row", not "wrong tenant".
   */
  async function assertProjectInOrg(projectId: string): Promise<void> {
    const project = await projectsRepo.findById(projectId);
    if (!project) {
      throw new Error("signature-ledger: project does not belong to the caller's organization");
    }
  }

  /**
   * 's guard. `dismissals.dismissed_by_user_id` FKs `user.id` globally, so without
   * this an arbitrary user id (including one in another org) could be stamped as the
   * author of a permanent, org-wide suppression. That makes the audit trail on org A's
   * own permanent record forgeable, and it is the exact column a future undo/appeal
   * flow would key on.
   *
   * Fail direction, reject (throw), not "null the attribution". Nulling would silently
   * rewrite the caller's claim into the documented system/backfill shape, making a
   * forgery attempt indistinguishable from a legitimate unattributed dismissal in the
   * very audit trail this protects. A caller that genuinely has no attributable member
   * passes `null` explicitly, which is accepted here and skips the lookup.
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
   * Resolves `signature` forward through `signature_ancestry` (add) for the write
   * paths: a caller holding a stale pre-re-key signature must land on the live row.
   *
   * An unresolvable walk (a cycle or the hop cap) has no "live" answer, so it degrades
   * to the original input signature. Logged, never thrown. That is the write half of
   * this file's one declared fail direction (see the design doc): the read path
   * suppresses, the write paths record against the unresolved signature, and both
   * branches only ever withhold a delivery or add suppression. Refusing here would
   * throw away the customer's dismissal, which is strictly worse.
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

      // `recordSignature` is the only producer of a signature. Every other
      // entry point either accepts one already computed or resolves one forward, never
      // re-derives it.
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
      // NO `assertProjectInOrg` here, deliberate. This is the one read entry
      // point: it writes nothing, and `ledgerRepo.findBySignature` already filters on
      // `ctx.organizationId` first, so a foreign project id finds no row and falls
      // through to the ordinary "never seen" decision. A guard here would be
      // defence-in-depth, not a correctness fix, and it would cost every consult an
      // extra round trip on the delivery hot path while changing the fail direction for
      // a legitimate caller from "deliver, never seen" to a thrown error. The integrity
      // hazard names (cascade-deleting another org's ledger rows) is reachable only
      // through a write, and every write is guarded above.
      //
      // A bare `SignatureHex` is a `string`; a `CandidateFinding` is not. That alone
      // discriminates the union with no brand check needed.
      const isCandidate = typeof input !== "string";

      if (isCandidate) {
        // The one catch boundary this service owns: an `evidenceShapeVersion` this
        // build has no registered serialiser for surfaces as a named suppression, never
        // a thrown error to the caller. Checked before computing a signature. Computing
        // one would succeed regardless (the candidate's `evidenceShape` is already a
        // serialised string), which is exactly why the version must be checked
        // explicitly rather than discovered as a side effect of some other call
        // throwing.
        if (!EVIDENCE_SHAPE_SERIALISERS.has(input.evidenceShapeVersion)) {
          // Logged with the version only, never the candidate's surface, which can
          // carry a live reset token or an email address (evidence-shape.ts's own
          // redaction rule, restated for this service's one catch boundary).
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

      // "dismissed forever" does not depend on the ledger row `dismissals` and
      // `finding_signatures` have two independent producers with no ordering guarantee
      // (a Slack "Not useful" click vs. the analysis lane), so the ledger row can be
      // missing, or present with a null `dismissed_at`, at the moment a dismissal
      // already exists. Reading only `finding_signatures.dismissed_at` here made the
      // permanent suppression silently fail in exactly that window. The `dismissals`
      // row is the durable record; the ledger stamp is the fast path.
      //
      // Cost is bounded: this second read runs only when the ledger has not already
      // answered "dismissed", so the steady state (dismissal stamped, ledger row
      // present) still costs one query on the delivery hot path.
      // `findLatestForSignature` is org- and project-filtered, so it widens nothing a
      // foreign project id could not already reach.
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
      // Before the transaction opens: the transaction below can never commit
      // with an unvalidated project or a forged author, because neither guard's failure
      // path reaches `db.transaction` at all.
      await assertProjectInOrg(input.projectId);
      await assertDismissedByIsMember(input.dismissedByUserId);

      const resolvedSignature = await resolveForward(input.signature);
      const now = new Date();

      // One transaction: the dismissal insert and the ledger's `dismissed_at` stamp
      // succeed together or not at all. A partial write would leave a dismissal that
      // suppresses nothing. Written on `tx` directly (see the design doc), never
      // through a repository factory, which `ScopedDb` cannot accept a transaction
      // handle for without a cast.
      return db.transaction(async (tx) => {
        // `onConflictDoNothing` keyed on the same tuple the unique index conflicts on:
        // a second identical dismissal is a no-op insert, not an error (idempotence).
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

        // `dismissed_at = coalesce(dismissed_at, $now)`, permanent once set; a replay
        // never moves the original instant.
        //
        // The row count is checked. This update legitimately matches zero rows when the
        // dismissal arrives before the analysis lane ever recorded the signature, two
        // independent producers, no ordering guarantee. It used to return success
        // regardless, and the permanent suppression evaporated the moment
        // `recordSignature` later inserted a fresh row with `dismissed_at = NULL`.
        //
        // Why not an upsert here: `finding_signatures` requires `symptom_class`,
        // `surface`, `signature_tuple_version`, and `evidence_shape_version` not NULL,
        // and a dismissal carries none of them. Inserting a ledger row from this path
        // would have to fabricate that provenance, and `upsertSeen`'s conflict-update
        // deliberately does not overwrite those columns, so the fabricated values would
        // be permanent and unrepairable. A row that lies about what a finding IS,
        // forever, is worse than an absent one.
        //
        // Why not throw: the `dismissals` insert above is the durable record of the
        // customer's decision, and `consultSignature` reads it as a fallback, so the
        // suppression holds without this stamp. Throwing would roll back a dismissal
        // that is already correct.
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
      // Before the transaction opens. Same reasoning as `recordDismissal`: a
      // rejected project never reaches `db.transaction`, so no transaction can commit
      // with an unvalidated project.
      await assertProjectInOrg(input.projectId);

      // One transaction: the edge insert and the carry-forward upsert succeed together
      // or not at all. The carry-forward half runs on `tx` here, sharing the one
      // definition of its values/conflict-update with `finding-signatures.repo.ts`'s
      // `carryForward`, rather than calling the repository method itself, which is
      // constructed over `db`, not `tx`, and could not share this transaction.
      return db.transaction(async (tx) => {
        // Idempotent on retry (post-sprint audit finding 2): guarded by
        // `onConflictDoNothing` on the same unique index the schema already enforces,
        // `(organization_id, old_signature)`. Every other write path in this service
        // degrades cleanly on replay (`upsertSeen`, `markDelivered`,
        // `recordDismissal`); this insert used to have no guard at all and raised a raw
        // Postgres unique violation on a second identical call.
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
          // Conflict: this old_signature already has a forward edge under this org. A
          // retry of this exact call, not a new mapping. The carry-forward below
          // already ran on the original call; it must not run again here, because
          // `times_seen = existing + old.times_seen` (`CARRY_FORWARD_SET`) is not
          // idempotent under a second application. Running it twice would double-count
          // the ledger. Read back the existing edge and return it unchanged, mirroring
          // `recordDismissal`'s own onConflictDoNothing-then-read-back idempotence.
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

        // The old signature may never have been recorded (e.g. a version-bump migration
        // ancestry edge drawn before any candidate under the old identity was ever seen
        // in this org/project scope). That is a legitimate degenerate case, not an
        // error: there is nothing to carry forward, so the edge stands alone and the
        // new signature starts its own ledger history the ordinary way, via
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
          // Upsert onto the new signature. The old row is never touched, staying in
          // place as the audit trail. The values and the conflict-update come from the
          // one shared definition in `finding-signatures.repo.ts`: only the query
          // builder differs between here and the repository, never the
          // semantics.
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
