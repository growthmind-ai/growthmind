import { randomUUID } from "node:crypto";

import { deriveWorkspaceName } from "@growthmind/shared";

import { member, organization } from "../schema/auth";
import type { ScopedDb } from "../repositories/types";
import { findMembershipsByUserId, findOrganizationBySlug } from "./queries";

interface EnsureOrganizationResult {
  organizationId: string;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null | undefined)?.cause;
  return cause?.code === "23505";
}

export async function ensureOrganization(
  db: ScopedDb,
  user: { id: string; name?: string | null },
): Promise<EnsureOrganizationResult> {
  const [existing] = await findMembershipsByUserId(db, user.id);
  if (existing) {
    return { organizationId: existing.organizationId };
  }

  console.error("ensureOrganization: no membership found for user — creating organization", {
    userId: user.id,
  });

  const organizationId = `org-${randomUUID()}`;
  const slug = `ws-${user.id}`;
  const name = deriveWorkspaceName(user.name);
  const createdAt = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({ id: organizationId, name, slug, createdAt });
      await tx.insert(member).values({
        id: `member-${randomUUID()}`,
        organizationId,
        userId: user.id,
        role: "owner",
        createdAt,
      });
    });

    return { organizationId };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      console.error("ensureOrganization: failed to create organization", {
        userId: user.id,
        error,
      });
      throw error;
    }

    console.error(
      "ensureOrganization: concurrent duplicate creation detected for user — re-reading winner's organization",
      { userId: user.id, slug },
    );

    const [winner] = await findMembershipsByUserId(db, user.id);
    if (winner) {
      return { organizationId: winner.organizationId };
    }

    const orphaned = await findOrganizationBySlug(db, slug);
    if (orphaned) {
      console.error(
        "ensureOrganization: org exists for slug but membership is missing — restoring membership",
        {
          userId: user.id,
          slug,
          organizationId: orphaned.id,
        },
      );

      await db.insert(member).values({
        id: `member-${randomUUID()}`,
        organizationId: orphaned.id,
        userId: user.id,
        role: "owner",
        createdAt,
      });

      return { organizationId: orphaned.id };
    }

    const notFoundError = new Error(
      `ensureOrganization: unique-slug conflict for user "${user.id}" but neither membership nor slug-owning organization found`,
    );
    console.error(
      "ensureOrganization: conflict re-read found neither membership nor organization",
      {
        userId: user.id,
        slug,
        error: notFoundError,
      },
    );
    throw notFoundError;
  }
}
