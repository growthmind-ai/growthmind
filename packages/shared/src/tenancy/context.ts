import { z } from "zod";

export const tenantContextSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  role: z.string(),
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

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

export type Membership = TenantResolutionInput["memberships"][number];
