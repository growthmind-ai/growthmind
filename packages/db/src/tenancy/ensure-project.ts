import { randomUUID } from "node:crypto";

import type { TenantContext } from "@growthmind/shared";
import { and, asc, eq } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { projects } from "../schema/projects";

import { logger } from "@growthmind/shared";
interface EnsureProjectResult {
  projectId: string;
}

function provisioningKeyFor(organizationId: string): string {
  return `org:${organizationId}`;
}

const DEFAULT_PROJECT_NAME = "Your product";

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null | undefined)?.cause;
  return cause?.code === "23505";
}

async function findFirstProjectForOrg(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, ctx.organizationId))
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .limit(1);

  return row;
}

export async function ensureProject(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<EnsureProjectResult> {
  const existing = await findFirstProjectForOrg(db, ctx);
  if (existing) {
    return { projectId: existing.id };
  }

  const provisioningKey = provisioningKeyFor(ctx.organizationId);

  try {
    const projectId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        organizationId: ctx.organizationId,
        name: DEFAULT_PROJECT_NAME,
        provisioningKey,
      });
    });

    return { projectId };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      logger.error("ensureProject: failed to provision project for organization", {
        organizationId: ctx.organizationId,
        error,
      });
      throw error;
    }

    logger.error(
      "ensureProject: concurrent duplicate provisioning detected for organization — re-reading winner's project",
      { organizationId: ctx.organizationId, provisioningKey },
    );

    const [winner] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, ctx.organizationId),
          eq(projects.provisioningKey, provisioningKey),
        ),
      )
      .limit(1);

    if (winner) {
      return { projectId: winner.id };
    }

    const notFoundError = new Error(
      `ensureProject: unique-key conflict for organization "${ctx.organizationId}" but no project owning the provisioning key was found`,
    );
    logger.error("ensureProject: conflict re-read found no project for the provisioning key", {
      organizationId: ctx.organizationId,
      provisioningKey,
      error: notFoundError,
    });
    throw notFoundError;
  }
}
