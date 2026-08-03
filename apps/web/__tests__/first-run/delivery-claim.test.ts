import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  createFindingsRepo,
  createSlackConnectionsRepo,
  eq,
  schema,
  type MeasuredCountRow,
  type ScopedDb,
} from "@growthmind/db";
import {
  firstRunDeliveryStateSchema,
  STAGE_DELIVERED_TEMPLATE,
  STAGE_DELIVERY_FAILED_TEMPLATE,
  STAGE_DELIVERY_PENDING_TEMPLATE,
  STAGE_RETIRE_CLOSURE,
  renderDeliveryLine,
  type DeliveryStatus,
  type FirstRunDeliveryState,
  type OnboardingFinding,
  type StagePersistedFacts,
} from "@growthmind/shared";

import { Stage } from "../../components/first-run/Stage";
import {
  buildFirstRunStatus,
  echoFirstRunStatus,
  toFirstRunDeliveryState,
} from "../../lib/first-run/status";

import { seedAnalysisRun } from "../../../../packages/db/__tests__/helpers/fixtures";
import {
  bodyOf,
  clockAt,
  createFirstRunTestBed,
  loadRouteHandler,
  routeById,
  routeRequest,
  tenantOf,
  type FirstRunRouteHandler,
  type FirstRunTestBed,
  type SeededMemberScope,
} from "../api/first-run/helpers/first-run-route-contract";

const STATUS = routeById("status");

const CLOCK = clockAt(new Date("2026-08-01T10:00:00.000Z"));

const COLD_BOOT_BUDGET_MS = 60_000;

const SAMPLE_CHANNEL = "C01AB2CD3EF";

const EVERY_DELIVERY_STATE: readonly FirstRunDeliveryState[] = firstRunDeliveryStateSchema.options;

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AppRouterContext.Provider, { value: FAKE_ROUTER }, node),
    ),
  );

const FINDING: OnboardingFinding = {
  finalClass: "something_is_not_working",
  headline: "Saving your workspace settings is not working.",
  context: ["Three people hit this in the last hour."],
  counts: [{ numerator: 3, denominator: 3, unit: "sessions" }],
  surface: "/settings",
  confidenceBasis: "above_floor",
  windowStart: new Date("2026-08-01T09:55:00.000Z"),
  windowEnd: new Date("2026-08-01T10:07:00.000Z"),
  summarySource: "model_rendered",
};

const FOUND: StagePersistedFacts = {
  armedAt: new Date("2026-08-01T09:59:00.000Z"),
  retrievedAt: new Date("2026-08-01T09:59:10.000Z"),
  readingAt: new Date("2026-08-01T09:59:20.000Z"),
  endedAt: new Date("2026-08-01T10:00:00.000Z"),
  runStatus: "completed",
  runOutcome: "produced_findings",
  finding: FINDING,
};

const stageMarkup = (delivery: FirstRunDeliveryState, channelId: string | null): string =>
  render(
    createElement(Stage, {
      facts: FOUND,
      nowMs: CLOCK().getTime(),
      channelId,
      findingUnavailable: false,
      delivery,
    }),
  );

const withChannel = (template: string, channelId: string): string =>
  template.replaceAll("{channel}", channelId);

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;
const FORWARD_LOOKING =
  /\bwill\b|\bsoon\b|\bshortly\b|\bnext\b|\bexpect\w*\b|\bshould\b|\bgoing to\b|\bany moment\b|\bin a few\b|\bwaiting for\b|\bremaining\b/i;
const BARE_STATUS = /\b[1-5]\d{2}\b/;
const LIVE_CLAIM = /\blive\b/i;
const APOLOGETIC = /\bsorry\b|\bunfortunately\b|\bcoming soon\b|!/i;
const MACHINE_IDENTIFIER = /\b[a-z]+_[a-z_]+\b/;

const ENGINEERING_JARGON = [
  "tenant",
  "adapter",
  "endpoint",
  "null",
  "undefined",
  "schema",
  "payload",
  "idempotent",
  "watermark",
  "upsert",
  "jsonb",
] as const;

const UX_BANNED_WORDS = [
  "scout",
  "signal",
  "report",
  "ingest",
  "pipeline",
  "surface",
  "signature",
  "SDK",
  "MCP",
  "org",
  "org-scoped",
] as const;

const WORD_BAN = (word: string): RegExp => new RegExp(`\\b${word}\\b`, "i");

function copyOffencesIn(sentence: string): readonly string[] {
  const offences: string[] = [];

  const add = (label: string, tripped: boolean): void => {
    if (tripped) offences.push(`${label} in: ${sentence}`);
  };

  add("DURATION", DURATION.test(sentence));
  add("HEDGE", HEDGE.test(sentence));
  add("FORWARD_LOOKING", FORWARD_LOOKING.test(sentence));
  add("LIVE_CLAIM", LIVE_CLAIM.test(sentence));
  add("APOLOGETIC", APOLOGETIC.test(sentence));
  add("BARE_STATUS", BARE_STATUS.test(sentence));
  add("MACHINE_IDENTIFIER", MACHINE_IDENTIFIER.test(sentence));

  for (const word of ENGINEERING_JARGON) add(`JARGON:${word}`, WORD_BAN(word).test(sentence));
  for (const word of UX_BANNED_WORDS) add(`BANNED:${word}`, WORD_BAN(word).test(sentence));

  return offences;
}

const MEASURED_COUNT: MeasuredCountRow = {
  numerator: 3,
  denominator: 10,
  unit: "sessions",
  timeframe: {
    start: new Date("2026-07-30T00:00:00.000Z"),
    end: new Date("2026-08-01T00:00:00.000Z"),
  },
  basis: { totalInWindow: 10, kept: 10, setAside: [] },
};

interface Lane {
  readonly scope: SeededMemberScope;
  readonly projectId: string;
  readonly findingId: string;
}

let bed: FirstRunTestBed;
let handle: FirstRunRouteHandler;
let orgA: Lane;
let teammateInA: SeededMemberScope;
let orgB: Lane;

const depsFor = (scope: SeededMemberScope | null) => ({
  db: bed.db,
  tenant: tenantOf(scope?.ctx ?? null),
  now: CLOCK,
});

async function projectOf(scope: SeededMemberScope): Promise<string> {
  await handle(routeRequest(STATUS), depsFor(scope));

  const rows = await bed.db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, scope.organizationId));

  const projectId = rows[0]?.id;
  if (rows.length !== 1 || projectId === undefined) {
    throw new Error(
      `expected GET ${STATUS.path} to provision exactly one project for the caller's org, found ${rows.length}`,
    );
  }
  return projectId;
}

async function seedFinding(scope: SeededMemberScope, projectId: string): Promise<string> {
  const run = await seedAnalysisRun(bed.db, { ctx: scope.ctx, projectId });
  const repo = createFindingsRepo(bed.db, scope.ctx);

  await repo.persist({
    projectId,
    runId: run.id,
    signature: randomUUID(),
    signatureVersion: 1,
    summarySource: "model_rendered",
    headline: "Checkout drops after the address step",
    context: ["One line of context, never a blob."],
    finalClass: "funnel_dropoff",
    surface: "/checkout",
    surfaceNormalisationVersion: 1,
    counts: [MEASURED_COUNT],
    confidenceBasis: "few_sessions",
    windowStart: new Date("2026-07-30T00:00:00.000Z"),
    windowEnd: new Date("2026-08-01T00:00:00.000Z"),
    evidenceShape: "shape-v1",
    evidenceShapeVersion: 1,
    resolvedModelId: "model-fixture",
  });

  const [row] = await repo.listForProject(projectId, { limit: 1 });
  if (row === undefined) throw new Error("the seeded finding could not be read back");
  return row.id;
}

async function seedLane(scope: SeededMemberScope): Promise<Lane> {
  const projectId = await projectOf(scope);

  await createSlackConnectionsRepo(bed.db, scope.ctx).insertActive({
    channelId: SAMPLE_CHANNEL,
    workspaceName: "Acme",
    credentialCiphertext: "v1.deadbeef.aaaa.bbbb.cccc",
    credentialKeyId: "deadbeef",
    connectedByUserId: scope.userId,
    connectedAt: new Date("2026-08-01T09:00:00.000Z"),
  });

  const findingId = await seedFinding(scope, projectId);
  return { scope, projectId, findingId };
}

async function showChannel(lane: Lane, channelId: string): Promise<void> {
  await bed.db
    .update(schema.slackConnections)
    .set({ channelId })
    .where(eq(schema.slackConnections.organizationId, lane.scope.organizationId));
}

async function seedDelivery(
  lane: Lane,
  input: {
    readonly channelId: string;
    readonly status: DeliveryStatus;
    readonly findingId?: string;
  },
): Promise<void> {
  await bed.db.insert(schema.deliveries).values({
    organizationId: lane.scope.organizationId,
    projectId: lane.projectId,
    findingId: input.findingId ?? lane.findingId,
    signature: randomUUID().replaceAll("-", ""),
    channelId: input.channelId,
    status: input.status,
    postedAt: input.status === "posted" ? new Date("2026-08-01T09:45:00.000Z") : null,
    failedAt: input.status === "failed" ? new Date("2026-08-01T09:45:00.000Z") : null,
    failureReason: input.status === "failed" ? "the channel refused the post" : null,
  });
}

async function deliveryStateFor(scope: SeededMemberScope): Promise<unknown> {
  const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(scope)));
  return body.deliveryState;
}

interface TableCounter {
  readonly db: ScopedDb;
  readonly reads: string[];
}

function countingDb(realDb: ScopedDb, named: ReadonlyMap<unknown, string>): TableCounter {
  const reads: string[] = [];

  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "from") {
          return (arg: unknown) => {
            const label = named.get(arg);
            if (label !== undefined) reads.push(label);
            const from = Reflect.get(target, prop, target) as (a: unknown) => unknown;
            return from.call(target, arg);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  const db = new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "select") {
        return (...args: unknown[]) => {
          const select = Reflect.get(target, prop, receiver) as (...a: unknown[]) => object;
          return wrapBuilder(select.apply(target, args));
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as ScopedDb;

  return { db, reads };
}

const BLIND_READ_SQL =
  'select * from "deliveries" where "organization_id" = $1 and "finding_id" = $2 and "channel_id" = $3';

function dbThatCannotReadDeliveries(realDb: ScopedDb, bound: readonly string[]): ScopedDb {
  const refuse = (): never => {
    throw Object.assign(new Error("the delivery record for this finding could not be read"), {
      query: BLIND_READ_SQL,
      parameters: [...bound],
    });
  };

  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "from") {
          return (arg: unknown) => {
            if (arg === schema.deliveries) refuse();
            const from = Reflect.get(target, prop, target) as (a: unknown) => unknown;
            return from.call(target, arg);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  return new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "select") {
        return (...args: unknown[]) => {
          const select = Reflect.get(target, prop, receiver) as (...a: unknown[]) => object;
          return wrapBuilder(select.apply(target, args));
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as ScopedDb;
}

beforeAll(async () => {
  bed = await createFirstRunTestBed("delivery-claim");
  handle = await loadRouteHandler(STATUS);

  const scopeA = await bed.member("a");
  teammateInA = await bed.member("a2", scopeA.organizationId);
  const scopeB = await bed.member("b");

  orgA = await seedLane(scopeA);
  orgB = await seedLane(scopeB);
}, COLD_BOOT_BUDGET_MS);

afterAll(async () => {
  await bed?.close();
});

describe("the pure delivery classifier", () => {
  test("the delivery state is none without a finding or a deliverable channel, and unposted with no row", () => {
    expect(
      toFirstRunDeliveryState({ hasFinding: false, channelId: SAMPLE_CHANNEL, delivery: null }),
    ).toBe("none");

    for (const channelId of [null, "null", "undefined", "", " "]) {
      expect(
        toFirstRunDeliveryState({
          hasFinding: true,
          channelId,
          delivery: { status: "posted" },
        }),
      ).toBe("none");
    }

    expect(
      toFirstRunDeliveryState({
        hasFinding: true,
        channelId: SAMPLE_CHANNEL,
        delivery: { status: "posted" },
      }),
    ).toBe("posted");

    expect(
      toFirstRunDeliveryState({
        hasFinding: true,
        channelId: SAMPLE_CHANNEL,
        delivery: { status: "failed" },
      }),
    ).toBe("failed");

    expect(
      toFirstRunDeliveryState({
        hasFinding: true,
        channelId: SAMPLE_CHANNEL,
        delivery: { status: "pending" },
      }),
    ).toBe("unposted");

    expect(
      toFirstRunDeliveryState({ hasFinding: true, channelId: SAMPLE_CHANNEL, delivery: null }),
    ).toBe("unposted");
  });

  test("renderDeliveryLine returns nothing to claim without a state and its constant otherwise", () => {
    expect(renderDeliveryLine("none", SAMPLE_CHANNEL)).toBeNull();

    for (const state of EVERY_DELIVERY_STATE) {
      expect(renderDeliveryLine(state, null)).toBeNull();
    }

    expect(renderDeliveryLine("posted", SAMPLE_CHANNEL)).toBe(
      withChannel(STAGE_DELIVERED_TEMPLATE, SAMPLE_CHANNEL),
    );
    expect(renderDeliveryLine("unposted", SAMPLE_CHANNEL)).toBe(
      withChannel(STAGE_DELIVERY_PENDING_TEMPLATE, SAMPLE_CHANNEL),
    );
    expect(renderDeliveryLine("failed", SAMPLE_CHANNEL)).toBe(
      withChannel(STAGE_DELIVERY_FAILED_TEMPLATE, SAMPLE_CHANNEL),
    );
  });

  test("every delivery sentence clears the shipped copy audit", () => {
    expect(copyOffencesIn("Sorry, this will land in about 30 seconds!").length).toBeGreaterThan(0);

    const sentences = [
      STAGE_RETIRE_CLOSURE,
      ...EVERY_DELIVERY_STATE.flatMap((state) =>
        [renderDeliveryLine(state, SAMPLE_CHANNEL), renderDeliveryLine(state, "growth")].filter(
          (line): line is string => line !== null,
        ),
      ),
    ];

    expect(sentences.length).toBeGreaterThan(1);
    expect(sentences.flatMap((sentence) => copyOffencesIn(sentence))).toEqual([]);
  });
});

describe("what the screen may claim about Slack", () => {
  test("a finding with a channel and no posted delivery renders no slack clause", async () => {
    await showChannel(orgA, "C24UNPOSTED");

    const state = await deliveryStateFor(orgA.scope);
    expect(state).toBe("unposted");

    const markup = stageMarkup("unposted", "C24UNPOSTED");
    expect(markup).not.toContain(withChannel(STAGE_DELIVERED_TEMPLATE, "C24UNPOSTED"));
    expect(markup).toContain(STAGE_RETIRE_CLOSURE);
  });

  test("a finding with a channel and a posted delivery renders the slack clause", async () => {
    await showChannel(orgA, "C25POSTED");
    await seedDelivery(orgA, { channelId: "C25POSTED", status: "posted" });

    const state = await deliveryStateFor(orgA.scope);
    expect(state).toBe("posted");

    const markup = stageMarkup("posted", "C25POSTED");
    expect(markup).toContain(withChannel(STAGE_DELIVERED_TEMPLATE, "C25POSTED"));
    expect(markup).toContain(STAGE_RETIRE_CLOSURE);
  });

  test("a posted delivery to a different channel does not make the clause true", async () => {
    await seedDelivery(orgA, { channelId: "C26ELSEWHERE", status: "posted" });
    await showChannel(orgA, "C26ONSCREEN");

    expect(await deliveryStateFor(orgA.scope)).toBe("unposted");
  });

  test("a finding whose delivery failed renders the failed sentence and no arrival claim", async () => {
    await showChannel(orgA, "C27FAILED");
    await seedDelivery(orgA, { channelId: "C27FAILED", status: "failed" });

    const state = await deliveryStateFor(orgA.scope);
    expect(state).toBe("failed");

    const markup = stageMarkup("failed", "C27FAILED");
    expect(markup).toContain(withChannel(STAGE_DELIVERY_FAILED_TEMPLATE, "C27FAILED"));
    expect(markup).not.toContain(withChannel(STAGE_DELIVERED_TEMPLATE, "C27FAILED"));
    expect(markup).toContain(STAGE_RETIRE_CLOSURE);
  });

  test("the closure sentence renders in every terminal state including a skipped slack", () => {
    expect(EVERY_DELIVERY_STATE.length).toBe(4);

    for (const channelId of [null, "null", SAMPLE_CHANNEL]) {
      for (const state of EVERY_DELIVERY_STATE) {
        const markup = stageMarkup(state, channelId);

        expect(`${String(channelId)}/${state}: ${markup.includes(STAGE_RETIRE_CLOSURE)}`).toBe(
          `${String(channelId)}/${state}: true`,
        );
        expect(`${String(channelId)}/${state}: ${markup.includes("#null")}`).toBe(
          `${String(channelId)}/${state}: false`,
        );
      }
    }
  });
});

describe("the delivery fact through the real entry points", () => {
  test("the delivery state is derived through the real status entry point", async () => {
    await showChannel(orgA, "C29WIRE");

    const body = await bodyOf(await handle(routeRequest(STATUS), depsFor(orgA.scope)));

    expect(Object.keys(body)).toContain("deliveryState");
    expect(firstRunDeliveryStateSchema.safeParse(body.deliveryState).success).toBe(true);
  });

  test("a delivery row written after the finding rendered flips the clause on the next poll", async () => {
    await showChannel(orgA, "C30LATE");

    expect(await deliveryStateFor(orgA.scope)).toBe("unposted");

    await seedDelivery(orgA, { channelId: "C30LATE", status: "posted" });

    expect(await deliveryStateFor(orgA.scope)).toBe("posted");
  });

  test("org A never reads org B's delivery row", async () => {
    await showChannel(orgA, "C31SHARED");

    await seedDelivery(orgB, {
      channelId: "C31SHARED",
      status: "posted",
      findingId: orgA.findingId,
    });

    expect(await deliveryStateFor(orgA.scope)).toBe("unposted");
    expect(await deliveryStateFor(orgA.scope)).not.toBe("posted");
  });

  test("a teammate who set nothing up sees the same delivery state", async () => {
    await showChannel(orgA, "C32TEAM");
    await seedDelivery(orgA, { channelId: "C32TEAM", status: "posted" });

    const owner = await deliveryStateFor(orgA.scope);
    const teammate = await deliveryStateFor(teammateInA);

    expect(teammate).toBe("posted");
    expect(teammate).toBe(owner);
  });

  test("the server-rendered path carries the same delivery state as the polled one", async () => {
    await showChannel(orgA, "C34PARITY");
    await seedDelivery(orgA, { channelId: "C34PARITY", status: "posted" });

    const echoed = await echoFirstRunStatus(bed.db, orgA.scope.ctx, orgA.projectId);
    const polled = await deliveryStateFor(orgA.scope);

    expect(echoed.deliveryState).toBe("posted");
    expect(echoed.deliveryState).toBe(polled);
  });
});

describe("the delivery read may never cost the screen", () => {
  test("a throwing delivery lookup does not blank the finding", async () => {
    await showChannel(orgA, "C33BLIND");

    const bound = [orgA.scope.organizationId, orgA.findingId, "C33BLIND"];
    const blind = dbThatCannotReadDeliveries(bed.db, bound);

    const payload = await buildFirstRunStatus({
      db: blind,
      ctx: orgA.scope.ctx,
      projectId: orgA.projectId,
      facts: FOUND,
      findingUnavailable: false,
    });

    expect(payload.deliveryState).toBe("none");
    expect(payload.finding).not.toBeNull();
    expect(payload.counter).not.toBeUndefined();

    const markup = stageMarkup(payload.deliveryState, payload.channelId);
    expect(markup).toContain(STAGE_RETIRE_CLOSURE);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(BLIND_READ_SQL);
    expect(serialized).not.toContain("select ");
  });

  test("the pre-arm poll adds no database read", async () => {
    const named = new Map<unknown, string>([
      [schema.findings, "findings"],
      [schema.deliveries, "deliveries"],
    ]);
    const counted = countingDb(bed.db, named);

    await buildFirstRunStatus({
      db: counted.db,
      ctx: orgA.scope.ctx,
      projectId: orgA.projectId,
      facts: {
        armedAt: null,
        retrievedAt: null,
        readingAt: null,
        endedAt: null,
        runStatus: null,
        runOutcome: null,
        finding: null,
      },
      findingUnavailable: false,
    });

    expect(counted.reads).toEqual([]);
  });
});
