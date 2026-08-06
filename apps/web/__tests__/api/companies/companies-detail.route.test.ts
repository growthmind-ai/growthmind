// GET /api/companies/[domain]'s handle(), driven through injected deps in the same
// handle(request, param, deps) shape as
// apps/web/__tests__/api/replays/replays.route.test.ts's events route. A throwing-proxy db
// proves the free-mail refusal never reaches a query; createTestDb() proves the D7 non-leak
// and the ph:/gm: story resolution end to end.
import { createRecordingSummariesRepo, type ScopedDb } from "@growthmind/db";
import {
  createTestDb,
  laneNames,
  scannedTextFor,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type TestDb,
} from "@growthmind/db/testing";
import { COMPANY_DETAIL_NOT_FOUND } from "@growthmind/shared";
import type { TenantContext } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { handle } from "../../../app/api/companies/[domain]/route";
import type { CompaniesRouteDeps } from "../../../lib/companies/deps";

const NAMES = laneNames("cd");

// The route's own local constant (ADD D-2/§5) — named again here because the route does not
// export it, the same reasoning the ADD gives for owning the magnitude per-package.
const COMPANY_SESSION_ROW_CAP = 100;

function throwingDb(): ScopedDb {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `GET /api/companies/[domain]: deps.db.${String(prop)} was touched by a caller that ` +
            "should never reach a query",
        );
      },
    },
  ) as ScopedDb;
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("GET /api/companies/[domain]", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedOrg(label: string) {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName(label),
    });
    const connection = await seedConnection(db, {
      organizationId: org.organizationId,
      projectId: project.id,
    });
    return { org, project, connection };
  }

  test("a free-mail domain is refused with 404 before any query is made", async () => {
    const ctx: TenantContext = {
      userId: "cd-user-1",
      organizationId: "cd-org-1",
      organizationName: "CD Org",
      role: "owner",
    };
    const deps: CompaniesRouteDeps = { db: throwingDb(), tenant: () => Promise.resolve(ctx) };

    const response = await handle(
      new Request("https://cd.invalid/api/companies/gmail.com"),
      "gmail.com",
      deps,
    );

    expect(response.status).toBe(404);
    expect((await bodyOf(response)).message).toBe(COMPANY_DETAIL_NOT_FOUND);
  });

  test("a domain belonging to another org gets the identical 404 shape as a typo'd domain", async () => {
    const owner = await seedOrg("cross-org-owner");
    await seedSession(db, {
      organizationId: owner.org.organizationId,
      projectId: owner.project.id,
      connectionId: owner.connection.id,
      sessionKey: "ph:cd-cross-org-session",
      identityEmailDomain: "acme.com",
      startedAt: new Date("2026-08-05T09:00:00.000Z"),
    });

    const foreign = await seedOrg("cross-org-foreign");
    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(foreign.org.ctx) };

    const foreignResponse = await handle(
      new Request("https://cd.invalid/api/companies/acme.com"),
      "acme.com",
      deps,
    );
    const typoResponse = await handle(
      new Request("https://cd.invalid/api/companies/typo-domain.com"),
      "typo-domain.com",
      deps,
    );

    expect(foreignResponse.status).toBe(404);
    expect(await bodyOf(foreignResponse)).toEqual(await bodyOf(typoResponse));
  });

  test("resolves a ph:-keyed session's recorded story and a gm:-keyed session's no_recording state in one response", async () => {
    const { org, project, connection } = await seedOrg("story");
    const recordingId = "cd-story-recording-1";

    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: `ph:${recordingId}`,
      identityEmailDomain: "acme.com",
      startedAt: new Date("2026-08-05T09:00:00.000Z"),
    });
    await seedSession(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      sessionKey: "gm:cd-story-identity:1",
      identityEmailDomain: "acme.com",
      startedAt: new Date("2026-08-05T09:05:00.000Z"),
    });

    const text = scannedTextFor("Someone hit a payment error at checkout", [
      "They opened /checkout, submitted payment, and saw an error.",
    ]);
    await createRecordingSummariesRepo(db, org.ctx).persist({
      projectId: project.id,
      recordingId,
      summarySource: "model_rendered",
      headline: text.headline,
      context: text.context,
      transcript: "0:00 opened /checkout",
      pages: ["/checkout"],
      durationMs: 45_000,
      actionCount: 4,
      notableCount: 1,
      droppedEvents: 0,
      startedAt: new Date("2026-08-05T09:00:00.000Z"),
      resolvedModelId: "test-model",
    });

    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(org.ctx) };
    const response = await handle(
      new Request("https://cd.invalid/api/companies/acme.com"),
      "acme.com",
      deps,
    );
    const body = await bodyOf(response);
    const sessions = body.sessions as {
      recordingId: string | null;
      story: { kind: string };
    }[];

    const resolved = sessions.find((session) => session.recordingId !== null);
    const noRecording = sessions.find((session) => session.recordingId === null);

    expect(resolved?.story.kind).toBe("resolved");
    expect(noRecording?.story.kind).toBe("no_recording");
  });

  test("sets truncated true once a single domain's session count exceeds the cap", async () => {
    const { org, project, connection } = await seedOrg("truncated");

    await Promise.all(
      Array.from({ length: COMPANY_SESSION_ROW_CAP + 1 }, (_, index) =>
        seedSession(db, {
          organizationId: org.organizationId,
          projectId: project.id,
          connectionId: connection.id,
          sessionKey: `ph:cd-truncated-${String(index)}`,
          identityEmailDomain: "acme.com",
          startedAt: new Date(Date.UTC(2026, 7, 5, 9, 0, index)),
        }),
      ),
    );

    const deps: CompaniesRouteDeps = { db, tenant: () => Promise.resolve(org.ctx) };
    const response = await handle(
      new Request("https://cd.invalid/api/companies/acme.com"),
      "acme.com",
      deps,
    );

    expect((await bodyOf(response)).truncated).toBe(true);
  });
});
