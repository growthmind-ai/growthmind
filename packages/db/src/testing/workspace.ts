import { randomUUID } from "node:crypto";

import type { TenantContext } from "@growthmind/shared";

import type { ScopedDb } from "../repositories/types";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedOrganization,
  seedProject,
  seedUser,
  type SeededProject,
} from "./fixtures";

export const SEED_PREFIX = "db-svc-";

export const OWNER_EMAIL_DOMAIN = "acme-example.test";

export function seedNames(label: string): {
  orgName: string;
  userName: string;
  email: string;
  projectName: string;
} {
  const unique = randomUUID();
  return {
    orgName: `${SEED_PREFIX}${label}-org`,
    userName: `${SEED_PREFIX}${label}-user`,
    email: `${SEED_PREFIX}${label}-${unique}@${OWNER_EMAIL_DOMAIN}`,
    projectName: `${SEED_PREFIX}${label}-project`,
  };
}

export interface SeededWorkspace {
  organizationId: string;
  userId: string;
  ctx: TenantContext;
  project: SeededProject;
}

export async function seedWorkspace(db: ScopedDb, label: string): Promise<SeededWorkspace> {
  const names = seedNames(label);
  const org = await seedOrgWithOwner(db, {
    orgName: names.orgName,
    userName: names.userName,
    email: names.email,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: names.projectName,
  });

  return {
    organizationId: org.organizationId,
    userId: org.userId,
    ctx: org.ctx,
    project,
  };
}

export async function seedWorkspaceWithoutOwner(
  db: ScopedDb,
  label: string,
): Promise<SeededWorkspace> {
  const names = seedNames(label);
  const org = await seedOrganization(db, { name: names.orgName });
  const user = await seedUser(db, { name: names.userName, email: names.email });
  await seedMember(db, { organizationId: org.id, userId: user.id, role: "member" });

  const ctx = makeTenantContext({
    userId: user.id,
    organizationId: org.id,
    organizationName: org.name,
    role: "member",
  });

  const project = await seedProject(db, { organizationId: org.id, name: names.projectName });

  return { organizationId: org.id, userId: user.id, ctx, project };
}
