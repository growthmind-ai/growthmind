import type { Membership } from "./context";

export function resolveActiveOrganization(
  memberships: Membership[],
  sessionActiveOrgId: string | null,
): string | null {
  if (memberships.length === 0) {
    return null;
  }

  if (sessionActiveOrgId !== null) {
    const isLiveMember = memberships.some(
      (membership) => membership.organizationId === sessionActiveOrgId,
    );

    if (isLiveMember) {
      return sessionActiveOrgId;
    }
  }

  const [oldest] = memberships.toSorted((a, b) => {
    const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();

    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return a.organizationId < b.organizationId ? -1 : a.organizationId > b.organizationId ? 1 : 0;
  });

  return oldest.organizationId;
}
