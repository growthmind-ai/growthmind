import {
  tenantResolutionInputSchema,
  type TenantContext,
  type TenantResolutionInput,
} from "./context";
import { resolveActiveOrganization } from "./resolve-active-organization";

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
