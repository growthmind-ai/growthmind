import { z } from "zod";

/**
 * The DTO boundary for a read credential: metadata only.
 *
 * There is deliberately NO `keyHash` and no raw-material field. The repository builds
 * this shape as an explicit field-by-field pick, never a spread of the persisted row. A
 * `...row` spread would leak the digest through every list and mint response with
 * nothing else failing, so a named test asserts this schema's exact key list.
 *
 * There is also deliberately no `projectId`. `write_keys` is dual-stamped with an
 * organisation and a project because a write key addresses one project's ingest; a read
 * credential addresses one organisation's findings, and `list_open_fixes` already takes
 * an optional project argument that a credential-borne project id would silently
 * override or contradict.
 */
export const apiKeyMetadataSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  /** Operator-supplied label, so a person can tell two agents' keys apart. */
  name: z.string(),
  keyPrefix: z.string(),
  /** Non-null means revoked, the resolver's `isNull` predicate reads this. */
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>;
