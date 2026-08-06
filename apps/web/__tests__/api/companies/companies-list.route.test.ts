// GET /api/companies's handle(), driven through injected deps exactly like
// apps/web/__tests__/api/replays/replays.route.test.ts's handle(request, deps) shape. A
// throwing-proxy db proves a signed-out caller never reaches a query; createTestDb() proves
// the real domain-grouping, free-mail-exclusion, and truncation behaviour end to end.
import { findFirstProjectForOrg, type ScopedDb } from "@growthmind/db";
import {
  createTestDb,
  laneNames,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type TestDb,
} from "@growthmind/db/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { handle } from "../../../app/api/companies/route";
import type { CompaniesRouteDeps } from "../../../lib/companies/deps";

const NAMES = laneNames("cl");

// The route's own local constant (ADD D-2/§5) — named again here because the route does not
// export it, the same reasoning the ADD gives for owning the magnitude per-package.
const GROUPABLE_SESSION_READ_CAP = 500;

function throwingDb(): ScopedDb {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `GET /api/companies: deps.db.${String(prop)} was touched by a caller that should ` +
            "never reach a query",
        );
      },
    },
  ) as ScopedDb;
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/companies", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedOrg(label: string) {
    return seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
  }

  test("a signed-out caller is refused with 401 and deps.db is never touched", async () => {
    const deps: CompaniesRouteDeps = {
      db: throwingDb(),
      tenant: () => Promise.resolve(null),
    };

    const response = await handle(new Request("https://cl.invalid/api/companies"), deps);

    expect(response.status).toBe(401);
  });

  test("an org with no project yet gets an empty list and provisions nothing", async () => {
    const org = await seedOrg("no-project");
    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(org.ctx) };

    const response = await handle(new Request("https://cl.invalid/api/companies"), deps);

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ groups: [], truncated: false });
    expect(await findFirstProjectForOrg(db, org.ctx)).toBeUndefined();
  });

  test("groups sessions by work domain, excluding free-mail and null-domain sessions", async () => {
    const org = await seedOrg("mixed-domains");
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("mixed-domains"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:cl-mixed-acme",
      identityEmailDomain: "acme.com",
      startedAt: new Date("2026-08-05T09:00:00.000Z"),
    });
    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "ph:cl-mixed-gmail",
      identityEmailDomain: "gmail.com",
      startedAt: new Date("2026-08-05T09:05:00.000Z"),
    });
    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "gm:cl-mixed-nodomain:1",
      identityEmailDomain: null,
      startedAt: new Date("2026-08-05T09:10:00.000Z"),
    });

    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(org.ctx) };
    const response = await handle(new Request("https://cl.invalid/api/companies"), deps);
    const body = await bodyOf(response);

    expect((body.groups as { domain: string }[]).map((group) => group.domain)).toEqual([
      "acme.com",
    ]);
  });

  test("sets truncated true once the groupable-session cap is exceeded", async () => {
    const org = await seedOrg("truncated");
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("truncated"),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });

    await Promise.all(
      Array.from({ length: GROUPABLE_SESSION_READ_CAP + 1 }, (_, index) =>
        seedSession(db, {
          organizationId: org.organizationId,
          projectId: project.id,
          connectionId: connection.id,
          sessionKey: `ph:cl-truncated-${String(index)}`,
          identityEmailDomain: "acme.com",
          startedAt: new Date(Date.UTC(2026, 7, 5, 9, 0, index)),
        }),
      ),
    );

    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(org.ctx) };
    const response = await handle(new Request("https://cl.invalid/api/companies"), deps);

    expect((await bodyOf(response)).truncated).toBe(true);
  });
});
