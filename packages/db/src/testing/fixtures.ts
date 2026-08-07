import { randomUUID } from "node:crypto";

import { reviewFindingText, type DetectorName, type ScannedText } from "@growthmind/core";
import { summarySourceSchema, tenantContextSchema, type TenantContext } from "@growthmind/shared";

import { createAnalysisRunsRepo } from "../repositories/analysis-runs.repo";
import type { MeasuredCountRow } from "../repositories/findings.repo";
import type { ScopedDb } from "../repositories/types";
import * as schema from "../schema";

export interface SeededOrganization {
  id: string;
  name: string;
  slug: string;
}

export async function seedOrganization(
  db: ScopedDb,
  params: { name: string },
): Promise<SeededOrganization> {
  const id = randomUUID();
  const slug = `org-${id}`;

  const [row] = await db
    .insert(schema.organization)
    .values({
      id,
      name: params.name,
      slug,
      createdAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedOrganization: insert returned no row");
  }

  return { id: row.id, name: row.name, slug: row.slug };
}

export interface SeededUser {
  id: string;
}

export async function seedUser(
  db: ScopedDb,
  params: { name: string; email: string },
): Promise<SeededUser> {
  const id = randomUUID();

  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: params.name,
      email: params.email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedUser: insert returned no row");
  }

  return { id: row.id };
}

export interface SeededMember {
  id: string;
}

export async function seedMember(
  db: ScopedDb,
  params: { organizationId: string; userId: string; role?: string; createdAt?: Date },
): Promise<SeededMember> {
  const id = randomUUID();

  const [row] = await db
    .insert(schema.member)
    .values({
      id,
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role ?? "member",
      createdAt: params.createdAt ?? new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedMember: insert returned no row");
  }

  return { id: row.id };
}

export function makeTenantContext(params: {
  userId: string;
  organizationId: string;
  organizationName: string;
  role?: string;
}): TenantContext {
  return tenantContextSchema.parse({
    userId: params.userId,
    organizationId: params.organizationId,
    organizationName: params.organizationName,
    role: params.role ?? "owner",
  });
}

export interface SeededOrgWithOwner {
  organizationId: string;
  organizationName: string;
  userId: string;
  ctx: TenantContext;
}

export async function seedOrgWithOwner(
  db: ScopedDb,
  params: { orgName: string; userName: string; email: string },
): Promise<SeededOrgWithOwner> {
  const org = await seedOrganization(db, { name: params.orgName });
  const user = await seedUser(db, { name: params.userName, email: params.email });
  await seedMember(db, { organizationId: org.id, userId: user.id, role: "owner" });

  const ctx = makeTenantContext({
    userId: user.id,
    organizationId: org.id,
    organizationName: org.name,
    role: "owner",
  });

  return { organizationId: org.id, organizationName: org.name, userId: user.id, ctx };
}

export interface SeededProject {
  id: string;
  name: string;
}

export async function seedProject(
  db: ScopedDb,
  params: { organizationId: string; name: string },
): Promise<SeededProject> {
  const [row] = await db
    .insert(schema.projects)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      name: params.name,
    })
    .returning();

  if (!row) {
    throw new Error("seedProject: insert returned no row");
  }

  return { id: row.id, name: row.name };
}

export interface SeededAnalysisRun {
  id: string;
}

export async function seedAnalysisRun(
  db: ScopedDb,
  params: { ctx: TenantContext; projectId: string; tickAt?: Date },
): Promise<SeededAnalysisRun> {
  const repo = createAnalysisRunsRepo(db, params.ctx);
  const { run } = await repo.open({
    projectId: params.projectId,
    tickAt: params.tickAt ?? new Date(),
  });

  return { id: run.id };
}

export interface SeededConnection {
  id: string;
  projectId: string;
}

export const PLACEHOLDER_CREDENTIAL_CIPHERTEXT = "v1.00000000.aaaa.bbbb.cccc";

export const PLACEHOLDER_CREDENTIAL_KEY_ID = "00000000";

export interface SeedConnectionParams {
  organizationId: string;
  projectId: string;
  host?: string;
  sourceProjectId?: string;

  // A real envelope where the test decrypts it; the placeholder otherwise.
  credentialCiphertext?: string;
  credentialKeyId?: string;
  isActive?: boolean;
  health?: "validating" | "healthy" | "failing" | "disconnected";
  watermarkAt?: Date | null;
  backfillBefore?: string | null;
  nextPollAt?: Date;
  pollIntervalSeconds?: number;
  connectedAt?: Date;
  inferredInternalDomain?: string | null;
}

export async function seedConnection(
  db: ScopedDb,
  params: SeedConnectionParams,
): Promise<SeededConnection> {
  const [row] = await db
    .insert(schema.projectConnections)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      sourceKind: "posthog",
      host: params.host ?? "https://eu.posthog.example.invalid",
      sourceProjectId: params.sourceProjectId ?? "00000",
      credentialCiphertext: params.credentialCiphertext ?? PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
      credentialKeyId: params.credentialKeyId ?? PLACEHOLDER_CREDENTIAL_KEY_ID,
      isActive: params.isActive ?? true,
      health: params.health ?? "healthy",
      watermarkAt: params.watermarkAt ?? null,
      backfillBefore: params.backfillBefore ?? null,
      nextPollAt: params.nextPollAt ?? new Date(),
      pollIntervalSeconds: params.pollIntervalSeconds ?? 60,
      connectedAt: params.connectedAt ?? new Date(),
      inferredInternalDomain: params.inferredInternalDomain ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("seedConnection: insert returned no row");
  }

  return { id: row.id, projectId: row.projectId };
}

export interface ScannedFindingText {
  readonly headline: ScannedText;
  readonly context: readonly ScannedText[];
}

export function scannedTextFor(
  headline: string,
  context: readonly string[] = [],
): ScannedFindingText {
  const verdict = reviewFindingText({ headline, context });

  if (verdict.held) {
    throw new Error(
      `scannedTextFor: the text given is held as ${verdict.why}, so no fixture may persist it`,
    );
  }

  return { headline: verdict.headline, context: verdict.context };
}

export interface SeedUnscannedFindingParams {
  readonly ctx: TenantContext;
  readonly projectId: string;
  readonly runId: string;
  readonly headline: string;
  readonly context: readonly string[];
  readonly signature?: string;
  readonly detector?: DetectorName;
  readonly surface?: string;
  readonly finalClass?: string;
  readonly counts?: readonly MeasuredCountRow[];
  readonly confidenceBasis?: string;
  readonly windowStart?: Date;
  readonly windowEnd?: Date;
  readonly evidenceShape?: string;
  readonly createdAt?: Date;
}

export interface SeededUnscannedFinding {
  readonly id: string;
}

const UNSCANNED_WINDOW_START = new Date("2026-07-24T00:00:00.000Z");

const UNSCANNED_WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

// Writes a findings row straight to the table, past the branded persist path, so a test can
// stand up the rows that predate the scan. Nothing outside `__tests__/` may reference it.
export async function seedUnscannedFinding(
  db: ScopedDb,
  params: SeedUnscannedFindingParams,
): Promise<SeededUnscannedFinding> {
  const surface = params.surface ?? "/checkout";

  const [row] = await db
    .insert(schema.findings)
    .values({
      id: randomUUID(),
      organizationId: params.ctx.organizationId,
      projectId: params.projectId,
      runId: params.runId,
      signature: params.signature ?? randomUUID(),
      signatureVersion: 1,
      detector: params.detector ?? "funnel_dropoff",
      summarySource: summarySourceSchema.enum.model_rendered,
      headline: params.headline,
      context: params.context,
      finalClass: params.finalClass ?? "confusing",
      surface,
      surfaceNormalisationVersion: 1,
      counts: params.counts ?? [],
      confidenceBasis: params.confidenceBasis ?? "28 kept sessions in a seven-day window",
      windowStart: params.windowStart ?? UNSCANNED_WINDOW_START,
      windowEnd: params.windowEnd ?? UNSCANNED_WINDOW_END,
      evidenceShape: params.evidenceShape ?? `funnel_dropoff:surface=${surface}`,
      evidenceShapeVersion: 1,
      resolvedModelId: "claude-sonnet-5",

      // OQ-2 pins timing rules on this column, so it is stored as written, never as now().
      createdAt: params.createdAt ?? new Date(),
    })
    .returning();

  if (!row) {
    throw new Error("seedUnscannedFinding: insert returned no row");
  }

  return { id: row.id };
}

export interface SeedNotificationParams {
  readonly organizationId: string;
  readonly type?: "finding_delivered" | "keys_revoked" | "agent_first_contact";
  readonly audience?: "org" | "owner";
  readonly subjectKind?: "finding" | "agent_key";
  readonly subjectId?: string;
  readonly actorUserId?: string | null;

  // `unknown` on purpose: production holds every payload shape ever written (D5), and the
  // tolerant-parse fixtures need to persist shapes today's schema refuses.
  readonly payload?: unknown;
  readonly dedupKey?: string;
  readonly createdAt?: Date;
}

export interface SeededNotification {
  readonly id: string;
}

// Writes a notifications row straight to the table, past the emit seam, so read-path tests
// can stand up rows without driving an emitter. Nothing outside `__tests__/` may use it.
export async function seedNotification(
  db: ScopedDb,
  params: SeedNotificationParams,
): Promise<SeededNotification> {
  const type = params.type ?? "keys_revoked";
  const subjectKind = params.subjectKind ?? (type === "finding_delivered" ? "finding" : "agent_key");

  const [row] = await db
    .insert(schema.notifications)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      type,
      audience: params.audience ?? "org",
      subjectKind,
      subjectId: params.subjectId ?? randomUUID(),
      actorUserId: params.actorUserId ?? null,
      payload: (params.payload ?? { type, v: 1 }) as (typeof schema.notifications.$inferInsert)["payload"],
      dedupKey: params.dedupKey ?? `seeded:${randomUUID()}`,
      ...(params.createdAt === undefined ? {} : { createdAt: params.createdAt }),
    })
    .returning();

  if (!row) {
    throw new Error("seedNotification: insert returned no row");
  }

  return { id: row.id };
}

export interface SeedNotificationSendParams {
  readonly organizationId: string;
  readonly notificationId: string;
  readonly channel?: "slack" | "web_push";
  readonly target?: string;
  readonly status?: "sent" | "failed" | "quiet";
  readonly quietReason?: string | null;
  readonly failureReason?: string | null;
  readonly messageRef?: string | null;
  readonly sentAt?: Date | null;
}

export async function seedNotificationSend(
  db: ScopedDb,
  params: SeedNotificationSendParams,
): Promise<{ readonly id: string }> {
  const [row] = await db
    .insert(schema.notificationSends)
    .values({
      id: randomUUID(),
      organizationId: params.organizationId,
      notificationId: params.notificationId,
      channel: params.channel ?? "slack",
      target: params.target ?? "C0FIXTURE",
      status: params.status ?? "sent",
      quietReason: params.quietReason ?? null,
      failureReason: params.failureReason ?? null,
      messageRef: params.messageRef ?? null,
      sentAt: params.sentAt ?? null,
    })
    .returning();

  if (!row) {
    throw new Error("seedNotificationSend: insert returned no row");
  }

  return { id: row.id };
}

// O-044's D11 wiring proof: worker/__tests__/analysis/cause.test.ts (producer half) and
// apps/web/__tests__/findings/detail-gate-emptied.test.ts (consumer half) must run against
// the SAME org/project/finding/divergence-row/session ids, or the "one wire, not a producer
// test and a consumer test that never touch each other" claim (ADD Decision 7/8, D11) is
// unenforced — two independently hand-copied literals can silently drift apart. A single
// exported constant is the enforcement; both suites import this, neither redeclares it.
export const CAUSE_STAGE_D11_FIXTURE = {
  organizationId: "o44-shared-org",
  organizationName: "Acme Shared D11",
  projectId: "o44-shared-project",
  findingId: "o44-shared-finding",
  surface: "/checkout",
  anchorSessionId: "o44-shared-session",
  windowStart: new Date("2026-07-30T00:00:00.000Z"),
  windowEnd: new Date("2026-08-06T00:00:00.000Z"),
} as const;
