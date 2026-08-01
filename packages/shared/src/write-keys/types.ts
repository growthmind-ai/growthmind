import { z } from "zod";

/**
 * `kind`/`origin` are Zod enums so a typo is a compile error, not a runtime one.
 * `packages/db`'s `write_keys.kind` column is typed from `writeKeyKindSchema`'s own
 * union.
 */
export const writeKeyKindSchema = z.enum(["standard", "simulation"]);
export type WriteKeyKind = z.infer<typeof writeKeyKindSchema>;

export const originSchema = z.enum(["real", "synthetic"]);
export type Origin = z.infer<typeof originSchema>;

/**
 * DTO boundary: metadata only. Never `keyHash`, never raw material. A test asserts this
 * schema's shape excludes both.
 */
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
