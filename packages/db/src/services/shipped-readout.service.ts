import {
  buildAtPageCorpus,
  renderShippedAcknowledgement,
  renderShippedReadout,
  shippedClaimGate,
  shippedCounts,
  shippedReadoutOutcome,
  type BuildAtPageCorpusResult,
  type ShippedAcknowledgement,
  type ShippedReadout,
  type ShippedReadoutResult,
} from "@growthmind/core";
import type { ShippedReadoutOutcome, TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { orgCrud } from "../repositories/crud";
import type { ShippedChangeRow } from "../repositories/shipped-changes.repo";
import type { ScopedDb } from "../repositories/types";
import { shippedChanges } from "../schema/shipped-changes";
import { createDetectorCorpusService } from "./detector-corpus.service";

export async function readShippedChangeForRender(
  db: ScopedDb,
  ctx: TenantContext,
  changeId: string,
): Promise<ShippedChangeRow | null> {
  return orgCrud(db, ctx, shippedChanges).maybe(eq(shippedChanges.id, changeId));
}

export async function renderChangeAcknowledgement(
  db: ScopedDb,
  ctx: TenantContext,
  changeId: string,
): Promise<ShippedAcknowledgement | null> {
  const change = await readShippedChangeForRender(db, ctx, changeId);

  if (change === null) return null;

  return renderShippedAcknowledgement({
    changeId: change.id,
    change: change.description,
    page: change.page,
    readoutDueAt: change.readoutDueAt,
  });
}

// The window is the change's own clock, so the denominator is the people who could have used it
// between the day it shipped and the day we said we would answer.
async function atPageCorpusFor(
  db: ScopedDb,
  ctx: TenantContext,
  change: ShippedChangeRow,
  projectId: string,
): Promise<BuildAtPageCorpusResult> {
  const corpus = await createDetectorCorpusService(db, ctx).read(projectId, {
    start: change.reportedAt,
    end: change.readoutDueAt,
  });

  return buildAtPageCorpus({
    corpus,
    kind: change.corpusKind,
    page: change.page,
    controlLabel: change.controlLabel,
    pageNormalisationVersion: change.pageNormalisationVersion,
  });
}

async function readoutResultFor(
  db: ScopedDb,
  ctx: TenantContext,
  change: ShippedChangeRow,
  projectId: string,
): Promise<ShippedReadoutResult> {
  const atPage = await atPageCorpusFor(db, ctx, change, projectId);

  if (!atPage.ok) return { kind: atPage.reason };

  const gate = shippedClaimGate(atPage.corpus);

  if (gate.kind === "too_few") return { kind: "too_few", corpus: atPage.corpus };

  return { kind: "claim", corpus: atPage.corpus, counts: shippedCounts(atPage.corpus) };
}

// The branch is read off the row and never decided again here. Classifying a second corpus at
// dispatch let a late-arriving session move the founder's message off the branch the row stores,
// and that column is what the verdict is recorded against and what a re-report reads.
async function shownResultFor(
  db: ScopedDb,
  ctx: TenantContext,
  change: ShippedChangeRow,
  projectId: string,
  outcome: ShippedReadoutOutcome,
): Promise<ShippedReadoutResult | null> {
  if (outcome === "stale_page_spelling" || outcome === "corpus_predates_who_counts") {
    return { kind: outcome };
  }

  const atPage = await atPageCorpusFor(db, ctx, change, projectId);

  if (!atPage.ok) return null;

  if (outcome === "too_few") return { kind: "too_few", corpus: atPage.corpus };

  return { kind: "claim", corpus: atPage.corpus, counts: shippedCounts(atPage.corpus) };
}

// What the readout will be able to say, decided at the moment the row is claimed as read out.
// A change with no project has no corpus to answer from and never reaches a reader, so it is
// left unrecorded rather than described as a branch nobody was shown.
export async function shippedReadoutOutcomeFor(
  db: ScopedDb,
  ctx: TenantContext,
  change: ShippedChangeRow,
): Promise<ShippedReadoutOutcome | null> {
  const projectId = change.projectId;
  if (projectId === null) return null;

  return shippedReadoutOutcome(await readoutResultFor(db, ctx, change, projectId));
}

export async function renderChangeReadout(
  db: ScopedDb,
  ctx: TenantContext,
  changeId: string,
): Promise<ShippedReadout | null> {
  const change = await readShippedChangeForRender(db, ctx, changeId);

  if (change === null) return null;

  // A change whose project is gone has no corpus to answer from; the tick moves that row to
  // abandoned rather than reading it out, so there is nothing honest to render here.
  const projectId = change.projectId;
  if (projectId === null) return null;

  // A row with no branch stored was never claimed as read out, so there is no answer to speak.
  const outcome = change.readoutOutcome;
  if (outcome === null) return null;

  const result = await shownResultFor(db, ctx, change, projectId, outcome);
  if (result === null) return null;

  return renderShippedReadout({
    changeId: change.id,
    change: change.description,
    page: change.page,
    leadCount: change.leadCount,
    result,
  });
}
