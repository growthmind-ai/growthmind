import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { AnalysisWindow } from "@growthmind/core";
import type { SessionCohortCuts } from "@growthmind/shared";

import { createDetectorCorpusService } from "../../src/services/detector-corpus.service";
import {
  createTestDb,
  laneNames,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("corpus-cuts");

const WINDOW: AnalysisWindow = {
  start: new Date("2026-07-29T00:00:00.000Z"),
  end: new Date("2026-08-05T00:00:00.000Z"),
};

const SESSION_STARTED_AT = new Date("2026-08-01T10:00:00.000Z");

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const GARBAGE_USER_AGENT = ' not-a-user-agent {"a":1} ÿ';

const CHROME_DESKTOP_CUTS = {
  browser: "chrome",
  device: "desktop",
} satisfies SessionCohortCuts;
const UNKNOWN_CUTS = { browser: "unknown", device: "unknown" } satisfies SessionCohortCuts;

interface SeededScope {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly ctx: Awaited<ReturnType<typeof seedOrgWithOwner>>["ctx"];
}

async function seedScope(db: TestDb, label: string): Promise<SeededScope> {
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

  return {
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    projectId: project.id,
    connectionId: connection.id,
    ctx: org.ctx,
  };
}

async function seedSessionWithUserAgent(
  db: TestDb,
  scope: SeededScope,
  sessionKey: string,
  userAgent: string | null,
): Promise<string> {
  const session = await seedSession(db, {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    connectionId: scope.connectionId,
    sessionKey,
    userAgent,
    entryUrlPath: "/pricing",
    startedAt: SESSION_STARTED_AT,
  });

  return session.id;
}

describe("detector corpus — cohort cuts are derived at the read boundary (FR-2, FR-11, D5, D7)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("derives a chrome/desktop cut from a Chrome-on-Windows user agent", async () => {
    const scope = await seedScope(db, "chrome-desktop");
    const sessionId = await seedSessionWithUserAgent(
      db,
      scope,
      "ph:corpus-cuts-chrome",
      CHROME_ON_WINDOWS,
    );

    const corpus = await createDetectorCorpusService(db, scope.ctx).read(scope.projectId, WINDOW);
    const session = corpus.sessions.find((row) => row.sessionId === sessionId);

    expect(session?.cohortCuts).toEqual(CHROME_DESKTOP_CUTS);
  });

  it("derives an unknown cut on both axes from a session with no user agent", async () => {
    const scope = await seedScope(db, "null-ua");
    const sessionId = await seedSessionWithUserAgent(db, scope, "ph:corpus-cuts-null", null);

    const corpus = await createDetectorCorpusService(db, scope.ctx).read(scope.projectId, WINDOW);
    const session = corpus.sessions.find((row) => row.sessionId === sessionId);

    expect(session?.cohortCuts).toEqual(UNKNOWN_CUTS);
  });

  it("never carries a raw user agent out of the corpus read", async () => {
    const scope = await seedScope(db, "no-raw-ua");
    await seedSessionWithUserAgent(db, scope, "ph:corpus-cuts-real", CHROME_ON_WINDOWS);
    await seedSessionWithUserAgent(db, scope, "ph:corpus-cuts-safari", SAFARI_ON_IPHONE);
    await seedSessionWithUserAgent(db, scope, "ph:corpus-cuts-garbage", GARBAGE_USER_AGENT);

    const corpus = await createDetectorCorpusService(db, scope.ctx).read(scope.projectId, WINDOW);
    const serialised = JSON.stringify(corpus.sessions);

    expect(corpus.sessions).toHaveLength(3);
    expect(serialised).not.toContain("Mozilla");
    expect(serialised).not.toContain("AppleWebKit");
    expect(serialised).not.toContain(GARBAGE_USER_AGENT);
  });

  it("does not return another organization's sessions after the select widens", async () => {
    const scopeA = await seedScope(db, "tenant-a");
    const scopeB = await seedScope(db, "tenant-b");

    const mine = await seedSessionWithUserAgent(
      db,
      scopeA,
      "ph:corpus-cuts-tenant-a",
      CHROME_ON_WINDOWS,
    );
    const theirs = await seedSessionWithUserAgent(
      db,
      scopeB,
      "ph:corpus-cuts-tenant-b",
      SAFARI_ON_IPHONE,
    );

    const corpus = await createDetectorCorpusService(db, scopeA.ctx).read(scopeA.projectId, WINDOW);
    const sessionIds = corpus.sessions.map((row) => row.sessionId);

    expect(sessionIds).toEqual([mine]);
    expect(sessionIds).not.toContain(theirs);
  });
});
