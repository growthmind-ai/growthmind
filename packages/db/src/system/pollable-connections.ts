import type { SessionSourceKind } from "@growthmind/shared";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { organization } from "../schema/auth";
import { projectConnections } from "../schema/project-connections";

export interface PollableConnection {
  readonly id: string;
  readonly organizationId: string;

  readonly organizationName: string;
  readonly projectId: string;
  readonly sourceKind: SessionSourceKind;
  readonly host: string;
  readonly sourceProjectId: string;

  readonly watermarkAt: Date | null;
  readonly backfillBefore: string | null;
  readonly pollIntervalSeconds: number;
  readonly connectedAt: Date;
  readonly inferredInternalDomain: string | null;
}

export async function claimDuePollableConnections(
  db: ScopedDb,
  params: { now: Date; limit: number },
): Promise<PollableConnection[]> {
  if (params.limit <= 0) {
    return [];
  }

  const due = db
    .select({ id: projectConnections.id })
    .from(projectConnections)
    .where(
      and(eq(projectConnections.isActive, true), lte(projectConnections.nextPollAt, params.now)),
    )
    .orderBy(asc(projectConnections.nextPollAt))
    .limit(params.limit)
    .for("update", { skipLocked: true });

  const claimed = await db
    .update(projectConnections)
    .set({
      nextPollAt: sql`${params.now}::timestamptz + (${projectConnections.pollIntervalSeconds} * interval '1 second')`,
    })
    .where(inArray(projectConnections.id, due))
    .returning();

  if (claimed.length === 0) {
    return [];
  }

  const orgIds = [...new Set(claimed.map((row) => row.organizationId))];
  const orgRows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(inArray(organization.id, orgIds));
  const orgNames = new Map(orgRows.map((row) => [row.id, row.name]));

  return claimed.map((row) => {
    const organizationName = orgNames.get(row.organizationId);
    if (organizationName === undefined) {
      throw new Error(
        `claimDuePollableConnections: no organization row for claimed connection ${row.id}`,
      );
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName,
      projectId: row.projectId,
      sourceKind: row.sourceKind,
      host: row.host,
      sourceProjectId: row.sourceProjectId,
      watermarkAt: row.watermarkAt,
      backfillBefore: row.backfillBefore,
      pollIntervalSeconds: row.pollIntervalSeconds,
      connectedAt: row.connectedAt,
      inferredInternalDomain: row.inferredInternalDomain,
    };
  });
}

export async function readConnectionCredential(
  db: ScopedDb,
  params: { connectionId: string; organizationId: string },
): Promise<{ ciphertext: string; keyId: string } | null> {
  const [row] = await db
    .select({
      ciphertext: projectConnections.credentialCiphertext,
      keyId: projectConnections.credentialKeyId,
    })
    .from(projectConnections)
    .where(
      and(
        eq(projectConnections.organizationId, params.organizationId),
        eq(projectConnections.id, params.connectionId),
      ),
    )
    .limit(1);

  return row ? { ciphertext: row.ciphertext, keyId: row.keyId } : null;
}
