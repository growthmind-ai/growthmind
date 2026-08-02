import { z } from "zod";

export const writeKeyKindSchema = z.enum(["standard", "simulation"]);
export type WriteKeyKind = z.infer<typeof writeKeyKindSchema>;

export const originSchema = z.enum(["real", "synthetic"]);
export type Origin = z.infer<typeof originSchema>;

export const writeKeyMetadataSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  organizationId: z.string(),
  kind: writeKeyKindSchema,
  keyPrefix: z.string(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type WriteKeyMetadata = z.infer<typeof writeKeyMetadataSchema>;
