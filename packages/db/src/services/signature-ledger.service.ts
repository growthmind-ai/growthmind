import {
  logger,
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
import { and, eq } from "drizzle-orm";

import { createDismissalsRepo, type DismissalRecord } from "../repositories/dismissals.repo";
import { createProjectsRepo } from "../repositories/projects.repo";
import {
  createFindingSignaturesRepo,
  type FindingSignatureRecord,
} from "../repositories/finding-signatures.repo";
import {
  createSignatureAncestryRepo,
  type AncestryRecord,
} from "../repositories/signature-ancestry.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { member } from "../schema/auth";
import { sha256Hex, type SignatureHex } from "../signatures/hex";

export interface ComputeFindingSignatureInput {
  readonly projectId: string;

  readonly surface: string;

  readonly symptomClass: FindingClass;

  readonly evidenceShape: string;
}

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

export interface RecordSignatureResult {
  readonly signature: SignatureHex;
  readonly record: FindingSignatureRecord;
}

export interface RecordDismissalInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly signature: SignatureHex;
  readonly action: DismissalAction;

  readonly dismissedByUserId: string | null;
}

export interface RecordAncestryInput {
  readonly projectId: string;
  readonly oldSignature: SignatureHex;
  readonly newSignature: SignatureHex;
  readonly reason: AncestryReason;
}

export interface SignatureLedgerService {
  recordSignature(projectId: string, candidate: CandidateFinding): Promise<RecordSignatureResult>;

  consultSignature(
    projectId: string,
    input: CandidateFinding | SignatureHex,
  ): Promise<SuppressionDecision>;

  markSignatureDelivered(
    projectId: string,
    signature: SignatureHex,
  ): Promise<FindingSignatureRecord | null>;

  recordDismissal(input: RecordDismissalInput): Promise<DismissalRecord>;

  recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord>;
}

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
  const s = scoped(db, ctx);
  const ledgerRepo = createFindingSignaturesRepo(db, ctx);
  const ancestryRepo = createSignatureAncestryRepo(db, ctx);
  const dismissalsRepo = createDismissalsRepo(db, ctx);
  const projectsRepo = createProjectsRepo(db, ctx);

  async function assertProjectInOrg(projectId: string): Promise<void> {
    const project = await projectsRepo.findById(projectId);
    if (!project) {
      throw new Error("signature-ledger: project does not belong to the caller's organization");
    }
  }

  async function assertDismissedByIsMember(userId: string | null): Promise<void> {
    if (userId === null) {
      return;
    }

    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(s.org(member), eq(member.userId, userId)));

    if (!row) {
      throw new Error(
        "signature-ledger: dismissedByUserId is not a member of the caller's organization",
      );
    }
  }

  async function resolveForward(signature: SignatureHex): Promise<SignatureHex> {
    const resolution = await ancestryRepo.resolve(signature);
    if (resolution.resolution === "resolved") {
      return resolution.signature;
    }

    logger.error(
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
      const isCandidate = typeof input !== "string";

      if (isCandidate) {
        if (!EVIDENCE_SHAPE_SERIALISERS.has(input.evidenceShapeVersion)) {
          logger.error("signature-ledger: unknown evidence_shape version — suppressing on doubt", {
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
        logger.error("signature-ledger: ancestry walk unresolvable — suppressing on doubt", {
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
      await assertProjectInOrg(input.projectId);
      await assertDismissedByIsMember(input.dismissedByUserId);

      const resolvedSignature = await resolveForward(input.signature);
      const now = new Date();

      return db.transaction(async (tx) => {
        const dismissalRow = await createDismissalsRepo(tx, ctx).record({
          projectId: input.projectId,
          findingId: input.findingId,
          signature: resolvedSignature,
          action: input.action,
          dismissedByUserId: input.dismissedByUserId,
          dismissedAt: now,
        });

        const stamped = await createFindingSignaturesRepo(tx, ctx).markDismissed(
          input.projectId,
          resolvedSignature,
          now,
        );

        if (!stamped) {
          logger.error(
            "signature-ledger: dismissal recorded before any ledger row exists for this signature — " +
              "suppression is held by the dismissals row, which consultSignature reads as a fallback",
            { findingId: input.findingId, action: input.action },
          );
        }

        return dismissalRow;
      });
    },

    async recordAncestry(input: RecordAncestryInput): Promise<AncestryRecord> {
      await assertProjectInOrg(input.projectId);

      return db.transaction(async (tx) => {
        const result = await createSignatureAncestryRepo(tx, ctx).claimEdge(input);

        if (!result.claimed) {
          return result.edge;
        }

        await createFindingSignaturesRepo(tx, ctx).carryForward({
          projectId: input.projectId,
          oldSignature: input.oldSignature,
          newSignature: input.newSignature,
        });

        return result.edge;
      });
    },
  };
}
