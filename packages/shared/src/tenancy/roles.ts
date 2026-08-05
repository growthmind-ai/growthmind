import { z } from "zod";

import type { TenantContext } from "./context";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ADMINISTERING_ROLES = ["owner", "admin"] as const satisfies readonly MemberRole[];

// A principal that is not a person: an API key acting for an org, or a scheduled task. Both
// carry a fixed role string, which is what lets `memberUserId` tell them from a human
// without knowing how either encodes its actor id.
export const MACHINE_ROLES = ["api_key", "system"] as const;

export type MachineRole = (typeof MACHINE_ROLES)[number];

export type PrincipalRole = MemberRole | MachineRole;

export const memberRoleSchema = z.enum(MEMBER_ROLES);

const ROLE_SEPARATOR = ",";

function normalise(raw: string): string {
  return raw.trim().toLowerCase();
}

// Better Auth holds a membership's roles in one free-form column and joins several with
// commas, so `role === "owner"` misses `"owner,admin"`. Names this file does not define are
// dropped rather than coerced: a role we cannot read grants nothing.
export function parseMemberRoles(raw: string): readonly MemberRole[] {
  const known: readonly string[] = MEMBER_ROLES;

  const parsed = raw
    .split(ROLE_SEPARATOR)
    .map(normalise)
    .filter((part): part is MemberRole => known.includes(part));

  return [...new Set(parsed)];
}

export function isMachinePrincipal(ctx: TenantContext): boolean {
  const machine: readonly string[] = MACHINE_ROLES;

  return machine.includes(normalise(ctx.role));
}

// The question every org-wide write asks. Fails closed — a role this file does not define
// cannot administer, which is the safe direction for a capability gate (D10).
export function mayAdminister(ctx: TenantContext): boolean {
  const administering: readonly string[] = ADMINISTERING_ROLES;

  return parseMemberRoles(ctx.role).some((role) => administering.includes(role));
}

// `TenantContext.userId` carries a real `user.id` for a person and a synthetic actor string
// for a key or a scheduled task. Any column referencing `user.id` must be written from this
// and never from the field: a synthetic id there is a foreign-key violation at write time.
export function memberUserId(ctx: TenantContext): string | null {
  return isMachinePrincipal(ctx) ? null : ctx.userId;
}
