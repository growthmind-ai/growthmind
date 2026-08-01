import type { Membership } from "./context";

/**
 * OQ-4 rule: the session's active organization if it matches a live membership;
 * otherwise the oldest membership by `createdAt`, tie-broken by organization id
 * (deterministic); otherwise `null` (the self-heal trigger state. Zero memberships).
 * Session state is a hint; persisted membership is the truth.
 *
 * Pure. Implemented in a later wave against the test names in
 * `packages/shared/__tests__/tenancy/resolve-active-organization.test.ts`.
 */
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
