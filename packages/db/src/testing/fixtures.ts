import { randomUUID } from "node:crypto";

import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

import { createAnalysisRunsRepo } from "../repositories/analysis-runs.repo";
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
