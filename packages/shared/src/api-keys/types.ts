import { z } from "zod";

export const apiKeyMetadataSchema = z.object({
  id: z.string(),
  organizationId: z.string(),

  name: z.string(),
  keyPrefix: z.string(),

  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>;
