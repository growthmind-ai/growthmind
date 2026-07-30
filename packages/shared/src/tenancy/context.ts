import { z } from "zod";

/**
 * The resolved tenant identity a request operates as. Every repository
 * factory in `packages/db` takes one of these at construction — it is the
 * only way to name an organization; there is no repository method that
 * accepts an organization id as a parameter (architecture §9, ADD D-B).
 */
export const tenantContextSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  role: z.string(),
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

/**
 * Input to `deriveTenantContext`. Deliberately has NO field that could carry
 * a client-supplied organization id (FR-3 / edge-taxonomy D7): the session
 * shape carries only the persisted `activeOrganizationId` hint, and
 * memberships come from a server-side membership query, never from request
 * input. Zod's default object behaviour strips unknown keys on parse (no
 * `.passthrough()` anywhere in this schema), so an injected top-level
 * org-override field is dropped rather than accepted.
 */
export const tenantResolutionInputSchema = z.object({
  session: z.object({
    userId: z.string(),
    activeOrganizationId: z.string().nullable(),
  }),
  memberships: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      role: z.string(),
      createdAt: z.date(),
    }),
  ),
});

export type TenantResolutionInput = z.infer<typeof tenantResolutionInputSchema>;

/** One row of `tenantResolutionInputSchema.memberships` — the shape
 * `resolveActiveOrganization` and `deriveTenantContext` consume. */
export type Membership = TenantResolutionInput["memberships"][number];
