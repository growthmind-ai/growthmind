import { tenantResolutionInputSchema, type TenantContext, type TenantResolutionInput } from "./context";
import { resolveActiveOrganization } from "./resolve-active-organization";

/**
 * Composes `resolveActiveOrganization` over `input.memberships` with
 * `input.session.activeOrganizationId`, then shapes the result into a
 * `TenantContext` for the resolved organization — or `null` when no
 * organization resolves (zero memberships; the self-heal trigger state,
 * ADD D-C/D8). Pure.
 *
 * Implemented in a later wave against the test names in
 * `packages/shared/__tests__/tenancy/derive-tenant-context.test.ts`.
 */
export function deriveTenantContext(input: TenantResolutionInput): TenantContext | null {
  const parsed = tenantResolutionInputSchema.parse(input);

  const activeOrganizationId = resolveActiveOrganization(
    parsed.memberships,
    parsed.session.activeOrganizationId,
  );

  if (activeOrganizationId === null) {
    return null;
  }

  const membership = parsed.memberships.find(
    (candidate) => candidate.organizationId === activeOrganizationId,
  );

  if (!membership) {
    return null;
  }

  return {
    userId: parsed.session.userId,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    role: membership.role,
  };
}
