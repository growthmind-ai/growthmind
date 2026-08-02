import { asc, eq } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { member, organization, user } from "../schema/auth";

export interface AdminOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
}

export interface AdminOrganizationCandidate {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerEmail: string | null;
}

export type ResolveOrganizationResult =
  | { readonly ok: true; readonly organization: AdminOrganization }
  | {
      readonly ok: false;
      readonly reason: "none_exist" | "ambiguous" | "not_found" | "no_owner";
      readonly candidates: readonly AdminOrganizationCandidate[];
    };

interface OrganizationOwner {
  readonly userId: string;
  readonly email: string;
}

export async function resolveOrganizationForCli(
  db: ScopedDb,
  input: { readonly org?: string },
): Promise<ResolveOrganizationResult> {
  const organizations = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .orderBy(asc(organization.createdAt), asc(organization.id));

  const ownerByOrganization = await readOwners(db);

  const candidates: AdminOrganizationCandidate[] = organizations.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerEmail: ownerByOrganization.get(row.id)?.email ?? null,
  }));

  const [only] = candidates;
  if (only === undefined) {
    return { ok: false, reason: "none_exist", candidates: [] };
  }

  let target: AdminOrganizationCandidate;

  if (input.org !== undefined && input.org.length > 0) {
    const named = input.org;
    const byId = candidates.find((candidate) => candidate.id === named);
    const matched = byId ?? candidates.find((candidate) => candidate.slug === named);
    if (matched === undefined) {
      return { ok: false, reason: "not_found", candidates };
    }
    target = matched;
  } else {
    if (candidates.length > 1) {
      return { ok: false, reason: "ambiguous", candidates };
    }
    target = only;
  }

  const owner = ownerByOrganization.get(target.id);
  if (owner === undefined) {
    return { ok: false, reason: "no_owner", candidates };
  }

  return {
    ok: true,
    organization: {
      id: target.id,
      name: target.name,
      slug: target.slug,
      ownerUserId: owner.userId,
      ownerEmail: owner.email,
    },
  };
}

async function readOwners(db: ScopedDb): Promise<Map<string, OrganizationOwner>> {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      userId: user.id,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.role, "owner"))
    .orderBy(asc(member.createdAt), asc(member.id));

  const owners = new Map<string, OrganizationOwner>();
  for (const row of rows) {
    if (row.email.length === 0 || owners.has(row.organizationId)) {
      continue;
    }
    owners.set(row.organizationId, { userId: row.userId, email: row.email });
  }
  return owners;
}
