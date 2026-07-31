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
// STUB (Wave 0B / T3, schema + TDD-contract task): every exported type and
// the factory's signature are FINAL. `computeFindingSignature`'s dispatch
// is real (ADD D-1: it is the ONE function that turns a candidate into a
// signature, and the only caller of `sha256Hex` in production code) — but
// because both `signatureTuple` and `sha256Hex` are themselves stubs that
// throw, calling it still throws "not implemented" today. Every other
// method's body throws "not implemented" directly; a later wave fills them
// in against the failing tests a later wave writes.
import type { AncestryReason, DismissalAction, TenantContext } from "@growthmind/shared";
import type { CandidateFinding, FindingClass, SuppressionDecision } from "@growthmind/core";
import { signatureTuple, SIGNATURE_TUPLE_VERSION } from "@growthmind/core";

import type { AncestryRecord } from "../repositories/signature-ancestry.repo";
import type { DismissalRecord } from "../repositories/dismissals.repo";
import type { FindingSignatureRecord } from "../repositories/finding-signatures.repo";
import type { ScopedDb } from "../repositories/types";
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
 * string; `sha256Hex` (this package, `../signatures/hex`) hashes it. Both
 * are themselves Wave 0B stubs whose bodies throw, so calling this today
 * throws "not implemented" too — the composition itself is real and will
 * not need to change when the next wave fills those two bodies in.
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

export function createSignatureLedgerService(
  db: ScopedDb,
  ctx: TenantContext,
): SignatureLedgerService {
  void db;
  void ctx;

  return {
    async recordSignature(
      projectId: string,
      candidate: CandidateFinding,
    ): Promise<RecordSignatureResult> {
      void projectId;
      void candidate;
      throw new Error("not implemented");
    },

    async consultSignature(
      projectId: string,
      input: CandidateFinding | SignatureHex,
    ): Promise<SuppressionDecision> {
      void projectId;
      void input;
      throw new Error("not implemented");
    },

    async markSignatureDelivered(
      projectId: string,
      signature: SignatureHex,
    ): Promise<FindingSignatureRecord | null> {
      void projectId;
      void signature;
      throw new Error("not implemented");
    },

    async recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord> {
      void input;
      throw new Error("not implemented");
    },

    async recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord> {
      void input;
      throw new Error("not implemented");
    },
  };
}
