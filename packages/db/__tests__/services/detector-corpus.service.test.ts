import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inArray } from "drizzle-orm";

import type { AnalysisWindow } from "@growthmind/core";
import type {
  AudienceRule,
  BusinessContext,
  IdentityResolution,
  SessionCohortCuts,
  StampedExclusionReason,
} from "@growthmind/shared";

import { growthContext } from "../../src/schema/growth-context";
import { sessions } from "../../src/schema/sessions";
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

async function seedIdentifiedSession(
  db: TestDb,
  scope: SeededScope,
  sessionKey: string,
  params: {
    readonly identityKey?: string | null;
    readonly identityEmailDomain?: string | null;
    readonly identityResolution?: IdentityResolution;
    readonly exclusionReason?: StampedExclusionReason;
  },
): Promise<string> {
  const session = await seedSession(db, {
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    connectionId: scope.connectionId,
    sessionKey,
    identityKey: params.identityKey ?? null,
    identityEmailDomain: params.identityEmailDomain ?? null,
    identityResolution: params.identityResolution ?? "unresolved",
    entryUrlPath: "/reports",
    startedAt: SESSION_STARTED_AT,
    exclusionReason: params.exclusionReason ?? "none",
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

// O-053 ADD Decision 2b: the rebuild over an at-page subcorpus needs two per-session facts
// the read aggregates away today, added as optional fields following the cohortCuts
// widening. RED in Wave 0: neither field is populated yet.
const AUDIENCE_IS_WORK_EMAIL: AudienceRule = {
  clauses: [{ attribute: "email_domain", is: "work" }],
};

const WORK_DOMAIN = "acme.test";

const ALPHA_KEY = "o053-identity-alpha-6f1c";
const BETA_KEY = "o053-identity-beta-2d90";

function businessContextConfirming(rule: AudienceRule): BusinessContext {
  return {
    facts: [
      {
        kind: "who_counts",
        statement: "People signing in with a work email address",
        provenance: {
          source: "stated_by_customer",
          at: new Date("2026-07-20T09:00:00.000Z"),
          citation: null,
          seen: null,
          statedBy: null,
        },
        correctedFrom: null,
        audience: {
          rule,
          status: "confirmed",
          decidedAt: new Date("2026-07-21T09:00:00.000Z"),
        },
        confirmation: null,
      },
    ],
    removed: [],
  };
}

describe("detector corpus — the per-session facts the at-page rebuild needs (O-053 Decision 2b)", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function confirmAudience(scope: SeededScope, rule: AudienceRule): Promise<void> {
    await db.insert(growthContext).values({
      id: randomUUID(),
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      businessContext: businessContextConfirming(rule),
    });
  }

  it("carries a whoCountsUnchecked flag whose recount equals the aggregate keptUnchecked", async () => {
    const scope = await seedScope(db, "who-counts-flag");
    await confirmAudience(scope, AUDIENCE_IS_WORK_EMAIL);

    // One session the rule can answer, two it cannot, and one already set aside — so the
    // unknown verdict is genuinely a minority of a mixed corpus rather than the whole of it.
    const answered = await seedIdentifiedSession(db, scope, "ph:o053-who-answered", {
      identityEmailDomain: WORK_DOMAIN,
      identityResolution: "resolved",
    });
    const unknownOne = await seedIdentifiedSession(db, scope, "ph:o053-who-unknown-1", {
      identityEmailDomain: null,
    });
    const unknownTwo = await seedIdentifiedSession(db, scope, "ph:o053-who-unknown-2", {
      identityEmailDomain: null,
    });
    const setAside = await seedIdentifiedSession(db, scope, "ph:o053-who-set-aside", {
      identityEmailDomain: null,
      exclusionReason: "automation_headless",
    });

    const corpus = await createDetectorCorpusService(db, scope.ctx).read(scope.projectId, WINDOW);
    const flagOf = (sessionId: string): boolean | null | undefined =>
      corpus.sessions.find((row) => row.sessionId === sessionId)?.whoCountsUnchecked;

    // Non-vacuity: an empty corpus, or a corpus nobody could fail to check, would make the
    // equality below true while the flag was never populated at all.
    expect(corpus.sessions).toHaveLength(4);
    expect(corpus.basis.keptUnchecked).toBe(2);

    const recount = corpus.sessions.filter((row) => row.whoCountsUnchecked === true).length;
    expect(recount).toBe(corpus.basis.keptUnchecked);

    expect(flagOf(unknownOne)).toBe(true);
    expect(flagOf(unknownTwo)).toBe(true);
    expect(flagOf(answered)).toBe(false);

    // A session already set aside is never re-evaluated, so it is checked rather than
    // unchecked — folding it into keptUnchecked would move a count between two rows.
    expect(flagOf(setAside)).toBe(false);
    expect(corpus.sessions.every((row) => typeof row.whoCountsUnchecked === "boolean")).toBe(true);
  });

  it("carries an identityGroup that is an equality class and never a key", async () => {
    const scope = await seedScope(db, "identity-group");

    const alphaFirst = await seedIdentifiedSession(db, scope, "ph:o053-alpha-1", {
      identityKey: ALPHA_KEY,
    });
    const alphaSecond = await seedIdentifiedSession(db, scope, "ph:o053-alpha-2", {
      identityKey: ALPHA_KEY,
    });
    const beta = await seedIdentifiedSession(db, scope, "ph:o053-beta-1", {
      identityKey: BETA_KEY,
    });
    const anonymous = await seedIdentifiedSession(db, scope, "ph:o053-anonymous", {
      identityKey: null,
    });

    const corpus = await createDetectorCorpusService(db, scope.ctx).read(scope.projectId, WINDOW);
    const groupOf = (sessionId: string): number | null | undefined =>
      corpus.sessions.find((row) => row.sessionId === sessionId)?.identityGroup;

    expect(corpus.sessions).toHaveLength(4);
    expect(typeof groupOf(alphaFirst)).toBe("number");
    expect(groupOf(alphaFirst)).toBe(groupOf(alphaSecond));
    expect(groupOf(beta)).not.toBe(groupOf(alphaFirst));

    // Absent identity is its own bucket, never merged into the majority (D5).
    expect(groupOf(anonymous)).toBeNull();

    // The control that keeps the scan below honest: the keys really are stored, so their
    // absence from the corpus is the derivation dropping them rather than nothing to drop.
    const stored = await db
      .select({ identityKey: sessions.identityKey })
      .from(sessions)
      .where(inArray(sessions.id, [alphaFirst, alphaSecond, beta, anonymous]));
    expect(
      stored
        .map((row) => row.identityKey)
        .filter((key) => key !== null)
        .toSorted(),
    ).toEqual([ALPHA_KEY, ALPHA_KEY, BETA_KEY]);

    const serialised = JSON.stringify(corpus);
    expect(serialised).not.toContain(ALPHA_KEY);
    expect(serialised).not.toContain(BETA_KEY);
  });
});
