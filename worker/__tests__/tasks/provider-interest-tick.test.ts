import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, test } from "bun:test";

import type { FetchLike } from "@growthmind/adapters";
import { sql } from "@growthmind/db";
import { createTestDb, seedOrgWithOwner, type TestDb } from "@growthmind/db/testing";
import { parseWorkerEnv, type WorkerEnv } from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  createRecordingLogger,
  jargonIn,
  testServerEnv,
  TEST_ENCRYPTION_KEY,
  type RecordingLogger,
} from "../helpers/wire-fixtures";

const PREFIX = "wk-interest-";
const NOW = new Date("2026-08-03T12:00:00.000Z");
const WEBHOOK_URL = "https://hooks.slack.invalid/services/T000/B000/wk-interest";
const EMAIL_SHAPE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

const OWNER = "O-024 ADD task 4.2 (worker/src/tasks/provider-interest-tick.ts)";
const MODULE = underConstructionSpecifier("worker/src/tasks/provider-interest-tick");

// Wave 0 contract shapes (AD-1/AD-10) — production types arrive with task 4.2.
interface InterestPostTextInput {
  readonly orgName: string;
  readonly displayName: string;
  readonly count: number;
}

type InterestPostText = (input: InterestPostTextInput) => string;

interface ProviderInterestTickDeps {
  readonly db: TestDb;
  readonly env: WorkerEnv;
  readonly fetch: FetchLike;
  readonly logger: RecordingLogger;
  readonly now: () => Date;
}

type RunProviderInterestTick = (deps: ProviderInterestTickDeps) => Promise<unknown>;

const loadInterestPostText = (): Promise<InterestPostText> =>
  loadUnderConstruction<InterestPostText>({
    modulePath: MODULE,
    exportName: "interestPostText",
    ownedBy: OWNER,
  });

const loadRunTick = (): Promise<RunProviderInterestTick> =>
  loadUnderConstruction<RunProviderInterestTick>({
    modulePath: MODULE,
    exportName: "runProviderInterestTick",
    ownedBy: OWNER,
  });

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

function envWithWebhook(): WorkerEnv {
  return parseWorkerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://fake:fake@localhost:5432/fake",
    BETTER_AUTH_SECRET: "wk-test-only-secret-not-a-real-one",
    GROWTHMIND_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    INTEREST_SLACK_WEBHOOK: WEBHOOK_URL,
  });
}

function tickDeps(params: {
  fetch: FetchLike;
  env?: WorkerEnv;
  logger?: RecordingLogger;
}): ProviderInterestTickDeps {
  return {
    db,
    env: params.env ?? testServerEnv(),
    fetch: params.fetch,
    logger: params.logger ?? createRecordingLogger(),
    now: () => NOW,
  };
}

async function seedOrg(name: string) {
  const suffix = randomUUID();
  return seedOrgWithOwner(db, {
    orgName: name,
    userName: `${PREFIX}owner-${suffix}`,
    email: `${PREFIX}owner-${suffix}@fixtures.invalid`,
  });
}

async function rawRows(query: unknown): Promise<Record<string, unknown>[]> {
  const executor = db as unknown as {
    execute(q: unknown): Promise<{ rows: unknown[] }>;
  };
  const { rows } = await executor.execute(query);
  return rows as Record<string, unknown>[];
}

async function seedInterestRow(params: {
  organizationId: string;
  requestedBy: string;
  provider?: "mixpanel" | "amplitude";
}): Promise<{ id: string }> {
  const id = randomUUID();
  const provider = params.provider ?? "mixpanel";
  await rawRows(
    sql`insert into provider_interest (id, organization_id, provider, requested_by)
        values (${id}, ${params.organizationId}, ${provider}, ${params.requestedBy})`,
  );
  return { id };
}

async function interestRows(): Promise<Record<string, unknown>[]> {
  return rawRows(sql`select id, notified_at from provider_interest`);
}

interface WebhookCall {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

interface FakeWebhook {
  readonly fetch: FetchLike;
  readonly calls: WebhookCall[];
}

function createFakeWebhook(options: { failWith?: string } = {}): FakeWebhook {
  const calls: WebhookCall[] = [];

  const fetchImpl = (async (input: Parameters<FetchLike>[0], init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    if (options.failWith !== undefined) {
      throw new TypeError(options.failWith);
    }
    return new Response("ok", { status: 200 });
  }) as FetchLike;

  return { fetch: fetchImpl, calls };
}

test("interestPostText says '1 workspace has asked' for a count of one — singular verb, no exclamation", async () => {
  const interestPostText = await loadInterestPostText();

  const text = interestPostText({ orgName: "Acme", displayName: "Mixpanel", count: 1 });

  expect(text).toContain("1 workspace has asked for Mixpanel.");
  expect(text).not.toContain("workspaces");
  expect(text).not.toContain("!");
});

test("interestPostText says '3 workspaces have asked' for a running count of three", async () => {
  const interestPostText = await loadInterestPostText();

  const text = interestPostText({ orgName: "Acme", displayName: "Mixpanel", count: 3 });

  expect(text).toContain("3 workspaces have asked for Mixpanel.");
  expect(text).not.toContain("!");
});

test("interestPostText escapes Slack control sequences — an org named <!channel> cannot ping the channel", async () => {
  const interestPostText = await loadInterestPostText();

  const text = interestPostText({
    orgName: "<!channel> & Sons",
    displayName: "Mix<pan>el",
    count: 1,
  });

  expect(text).toContain("&lt;!channel&gt; &amp; Sons asked for Mix&lt;pan&gt;el.");
  expect(text).toContain("1 workspace has asked for Mix&lt;pan&gt;el.");
  expect(text).not.toContain("<!channel>");
  expect(text).not.toContain("Mix<pan>el");
});

test("interestPostText carries the org and provider display names and nothing person-shaped", async () => {
  const interestPostText = await loadInterestPostText();

  const text = interestPostText({ orgName: "Meridian Retail", displayName: "Amplitude", count: 2 });

  expect(text).toContain("Meridian Retail");
  expect(text).toContain("Amplitude");
  expect(text).not.toContain("@");
  expect(text).not.toMatch(EMAIL_SHAPE);
});

test("with the webhook unconfigured the tick claims nothing, posts nothing, and logs one plain sentence", async () => {
  const runTick = await loadRunTick();
  const org = await seedOrg(`${PREFIX}quiet-org`);
  await seedInterestRow({ organizationId: org.organizationId, requestedBy: org.userId });
  const webhook = createFakeWebhook();
  const logger = createRecordingLogger();

  await runTick(tickDeps({ fetch: webhook.fetch, logger }));

  expect(webhook.calls).toEqual([]);
  expect(logger.infos.length).toBe(1);
  expect(jargonIn(logger.infos[0] ?? "")).toEqual([]);
  expect(logger.errors).toEqual([]);

  const rows = await interestRows();
  expect(rows.length).toBe(1);
  expect(rows[0]?.["notified_at"]).toBeNull();
});

test("one unnotified row produces exactly one webhook post derived from the row and stamps the claim", async () => {
  const runTick = await loadRunTick();
  const org = await seedOrg(`${PREFIX}Acme-Analytics`);
  await seedInterestRow({
    organizationId: org.organizationId,
    requestedBy: org.userId,
    provider: "mixpanel",
  });
  const webhook = createFakeWebhook();

  await runTick(tickDeps({ fetch: webhook.fetch, env: envWithWebhook() }));

  expect(webhook.calls.length).toBe(1);
  const call = webhook.calls[0];
  expect(call?.url).toBe(WEBHOOK_URL);
  expect(call?.method).toBe("POST");
  expect(call?.body).toContain(org.organizationName);
  expect(call?.body).toContain("Mixpanel");
  expect(call?.body).toContain("1 workspace");

  const rows = await interestRows();
  expect(rows.length).toBe(1);
  expect(rows[0]?.["notified_at"]).not.toBeNull();
});

test("a second tick immediately after success posts nothing — the stamp guards the send", async () => {
  const runTick = await loadRunTick();
  const org = await seedOrg(`${PREFIX}replay-org`);
  await seedInterestRow({ organizationId: org.organizationId, requestedBy: org.userId });
  const env = envWithWebhook();

  const first = createFakeWebhook();
  await runTick(tickDeps({ fetch: first.fetch, env }));
  expect(first.calls.length).toBe(1);

  const second = createFakeWebhook();
  await runTick(tickDeps({ fetch: second.fetch, env }));
  expect(second.calls).toEqual([]);
});

test("a throwing webhook is logged with org, provider, and row id — the tick completes, never retries, never un-stamps", async () => {
  const runTick = await loadRunTick();
  const org = await seedOrg(`${PREFIX}down-webhook-org`);
  const row = await seedInterestRow({
    organizationId: org.organizationId,
    requestedBy: org.userId,
    provider: "mixpanel",
  });
  const webhook = createFakeWebhook({ failWith: "socket hang up" });
  const logger = createRecordingLogger();

  await runTick(tickDeps({ fetch: webhook.fetch, env: envWithWebhook(), logger }));

  expect(webhook.calls.length).toBe(1);
  expect(logger.errors.length).toBe(1);
  const error = (logger.errors[0] ?? "").toLowerCase();
  expect(error).toContain(org.organizationId.toLowerCase());
  expect(error).toContain("mixpanel");
  expect(error).toContain(row.id.toLowerCase());

  const rows = await interestRows();
  expect(rows[0]?.["notified_at"]).not.toBeNull();
});

test("the tick takes deps alone — provider identity comes from the row, not a payload", async () => {
  const runTick = await loadRunTick();
  expect(runTick.length).toBe(1);

  const org = await seedOrg(`${PREFIX}deps-only-org`);
  await seedInterestRow({
    organizationId: org.organizationId,
    requestedBy: org.userId,
    provider: "amplitude",
  });
  const webhook = createFakeWebhook();

  await runTick(tickDeps({ fetch: webhook.fetch, env: envWithWebhook() }));

  expect(webhook.calls.length).toBe(1);
  expect(webhook.calls[0]?.body).toContain("Amplitude");
});
