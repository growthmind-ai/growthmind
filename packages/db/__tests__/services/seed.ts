// Fixture seeding for the `packages/db` SERVICE suites (O-003 Wave 0b, lane 4).
//
// EVERY name and email produced here carries the `db-svc-` prefix and a fresh
// UUID. The previous sprint lost time to four suites failing on
// `user_email_unique` from reused fixture emails — a red state that looked
// correct but was not — so a collision here is treated as a defect in this
// file, never as a legitimate failure.
import { randomUUID } from "node:crypto";

import type { TenantContext } from "@growthmind/shared";

import type { TestDb } from "../../src/testing";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedOrganization,
  seedProject,
  seedUser,
  type SeededProject,
} from "../helpers/fixtures";

/** The lane's fixture seed prefix. Lane 3 owns `db-`; this lane owns `db-svc-`. */
export const SEED_PREFIX = "db-svc-";

/**
 * The org owner's email domain in these fixtures. An obviously-fake `.test`
 * domain — this repository is public — and deliberately NOT a free-mail
 * domain, so internal-domain inference has something to infer.
 */
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

/** An org with an owner whose email domain is `OWNER_EMAIL_DOMAIN`, plus one project. */
export async function seedWorkspace(db: TestDb, label: string): Promise<SeededWorkspace> {
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

/**
 * An org whose only member is a plain `member` — there is NO owner row, so
 * `creatorEmail()` has nothing to resolve. The F-2 fixture: a missing creator
 * email must make the service infer NOTHING rather than guess.
 */
export async function seedWorkspaceWithoutOwner(
  db: TestDb,
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
