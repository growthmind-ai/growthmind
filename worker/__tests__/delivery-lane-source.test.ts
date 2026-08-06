import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COUNT_ROLES, scanResidualPii, type CandidateFinding, type CountRole } from "@growthmind/core";
import type { SignatureHex, SignatureLedgerService } from "@growthmind/db";
import { SYSTEM_ACTOR_ROLE } from "@growthmind/db/system";
import { createTestDb } from "@growthmind/db/testing";
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";
import type { SuppressionDecision } from "@growthmind/core";
import { describe, expect, test } from "bun:test";

import {
  FINDINGS_CONSIDERED_PER_LANE,
  createDeliveryLaneSource,
  type DeliveryLaneSourceDeps,
} from "../src/delivery-lane-source";
import { DELIVERY_ACTOR_ID } from "../src/tasks/delivery-tick";
import {
  createRecordingDeliveryLogger,
  seedFinding,
  seedSlackConnection,
} from "./helpers/onboarding-delivery-fixtures";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

// ADD o-019-dismissal-wired Decision 4: `DeliveryLaneSourceDeps` gains a `ledgerFor`
// dependency, mirroring `AnalysisLaneDeps.ledgerFor` exactly. Not on the deps type yet,
// so declared locally here (a TODO for production) rather than imported — see the ADD's
// own note that the two aliases are structurally interchangeable regardless.
type SignatureLedgerFor = (ctx: TenantContext) => SignatureLedgerService;

type DeliveryLaneSourceDepsWithLedger = DeliveryLaneSourceDeps & {
  readonly ledgerFor: SignatureLedgerFor;
};

function refusesHere(name: string): () => never {
  return () => {
    throw new Error(`delivery-lane-source test: ${name} should not be called in this test`);
  };
}

// A permissive-by-default fake: any signature not named in `decisions` delivers, so a
// test only has to name the signatures it cares about suppressing or throwing on.
function fakeLedgerFor(
  decisions: ReadonlyMap<string, SuppressionDecision | "throw">,
): SignatureLedgerFor {
  return () => ({
    recordSignature: refusesHere("recordSignature"),
    consultSignature: (_projectId: string, input: CandidateFinding | SignatureHex) => {
      const signature = typeof input === "string" ? input : "";
      const decision = decisions.get(signature);

      if (decision === "throw") {
        return Promise.reject(new Error(`fakeLedgerFor: consultSignature refused for ${signature}`));
      }

      return Promise.resolve(
        decision ?? ({ decision: "deliver", reason: "not_seen_before" } satisfies SuppressionDecision),
      );
    },
    markSignatureDelivered: refusesHere("markSignatureDelivered"),
    recordDismissal: refusesHere("recordDismissal"),
    recordAncestry: refusesHere("recordAncestry"),
  });
}

function laneSourceWithLedger(
  deps: DeliveryLaneSourceDeps,
  ledgerFor: SignatureLedgerFor,
): ReturnType<typeof createDeliveryLaneSource> {
  const withLedger = { ...deps, ledgerFor } as DeliveryLaneSourceDepsWithLedger;
  return createDeliveryLaneSource(withLedger);
}

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SOURCE = readFileSync(
  path.join(REPO_ROOT, "worker", "src", "delivery-lane-source.ts"),
  "utf8",
);

const LOCAL_FUNCTION = /\bfunction\s+toMeasuredCount\s*\(/;

const LOCAL_BINDING = /\b(?:const|let|var)\s+toMeasuredCount\s*[:=]/;

const CORE_IMPORT = /import\s*\{[^}]*\btoMeasuredCount\b[^}]*\}\s*from\s*["']@growthmind\/core["']/;

describe("worker/src/delivery-lane-source.ts", () => {
  // D12: two brand minters fork the moment `MeasuredCount` grows a field, and nothing
  // fails — the second minter just keeps producing the older shape.
  test("mints a measured count from a persisted row in exactly one place", () => {
    expect(LOCAL_FUNCTION.test(SOURCE)).toBe(false);
    expect(LOCAL_BINDING.test(SOURCE)).toBe(false);

    expect(CORE_IMPORT.test(SOURCE)).toBe(true);

    // The lane must still USE it, or the two rows above pass by deletion.
    expect(/\btoMeasuredCount\s*\(/.test(SOURCE)).toBe(true);
  });

  // `findings` persists its own detector (decision 0016) — this file must resolve labels from
  // that column directly, never by count arity. `funnel_dropoff` and `observed_struggle` both
  // declare two counts, which is exactly the pair an arity-keyed lookup used to collide on.
  test("never resolves a finding's Slack copy by its count arity", () => {
    expect(/\bROLES_BY_ARITY\b/.test(SOURCE)).toBe(false);
    expect(/\.counts\.length\)/.test(SOURCE)).toBe(false);
  });
});

const NOW = new Date("2026-08-01T12:00:00.000Z");

const OWNER_SCHEMA = "packages/db/src/schema/slack-connections.ts";

const CHANNEL = "C0LANESOURCE";

const PLANTED_EMAIL = "buyer@o21-northwind-shop.example";

const PLANTED_EMAIL_KIND = "email_address";

const HELD_CONTEXT = [`Sessions from ${PLANTED_EMAIL} left without finishing.`];

const CLEAN_CONTEXT = ["Sessions reached the payment step and left without finishing."];

function deliveryContextFor(organizationId: string, organizationName: string): TenantContext {
  return tenantContextSchema.parse({
    userId: DELIVERY_ACTOR_ID,
    organizationId,
    organizationName,
    role: SYSTEM_ACTOR_ROLE,
  });
}

test("a finding whose persisted text is held never becomes a delivery candidate, and the hold is logged with its kind at warn", async () => {
  expect(scanResidualPii(HELD_CONTEXT.join("\n")).clean).toBe(false);
  expect(scanResidualPii(CLEAN_CONTEXT.join("\n")).clean).toBe(true);

  const { db, close } = await createTestDb();

  try {
    const workspace = await seedPollableWorkspace(db, { prefix: "o21-lane-", now: NOW });
    const ctx = deliveryContextFor(workspace.organizationId, workspace.organizationName);

    await seedSlackConnection(
      db,
      { organizationId: workspace.organizationId, channelId: CHANNEL },
      OWNER_SCHEMA,
    );

    const held = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/payment",
      context: HELD_CONTEXT,
      at: NOW,
    });

    const sibling = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const logger = createRecordingDeliveryLogger();
    const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

    const candidateIds = (lane?.candidates ?? []).map((candidate) => candidate.findingId);
    expect(candidateIds).not.toContain(held.findingId);
    expect(candidateIds).toContain(sibling.findingId);

    // `warn`, not `error`: this line repeats on every tick for as long as the row exists.
    expect(
      logger.warns.filter(
        (line) => line.includes(held.findingId) && line.includes(PLANTED_EMAIL_KIND),
      ),
    ).toHaveLength(1);
    expect(logger.errors.filter((line) => line.includes(held.findingId))).toEqual([]);
    expect(logger.lines().filter((line) => line.includes(sibling.findingId))).toEqual([]);

    for (const line of logger.lines()) {
      expect(line).not.toContain(PLANTED_EMAIL);
    }
  } finally {
    await close();
  }
});

test("held findings spend no consideration slot, so a project with a lane's worth of them still delivers", async () => {
  const { db, close } = await createTestDb();

  try {
    const workspace = await seedPollableWorkspace(db, { prefix: "o21-slot-", now: NOW });
    const ctx = deliveryContextFor(workspace.organizationId, workspace.organizationName);

    await seedSlackConnection(
      db,
      { organizationId: workspace.organizationId, channelId: CHANNEL },
      OWNER_SCHEMA,
    );

    // Oldest first, so it sits past the consideration budget once the held rows are in
    // front of it — the exact arrangement that used to stop this project delivering.
    const deliverable = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    for (let index = 0; index < FINDINGS_CONSIDERED_PER_LANE; index += 1) {
      await seedFinding(db, ctx, {
        projectId: workspace.projectId,
        surface: "/checkout/payment",
        context: HELD_CONTEXT,
        at: NOW,
      });
    }

    const logger = createRecordingDeliveryLogger();
    const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

    expect((lane?.candidates ?? []).map((candidate) => candidate.findingId)).toContain(
      deliverable.findingId,
    );
    expect(logger.warns).toHaveLength(FINDINGS_CONSIDERED_PER_LANE);
    expect(logger.errors).toEqual([]);
  } finally {
    await close();
  }
}, 60_000);

// The rendered half of decision 0016's fix. `funnel_dropoff` and `observed_struggle` both
// persist exactly two counts — the arity that used to collide — so the only way this passes
// is if the label lookup reads `finding.detector`, never the shape of `finding.counts`.
test("a funnel_dropoff and an observed_struggle finding with the same count arity render their own distinct labels", async () => {
  const { db, close } = await createTestDb();

  try {
    const workspace = await seedPollableWorkspace(db, { prefix: "o46-labels-", now: NOW });
    const ctx = deliveryContextFor(workspace.organizationId, workspace.organizationName);

    await seedSlackConnection(
      db,
      { organizationId: workspace.organizationId, channelId: CHANNEL },
      OWNER_SCHEMA,
    );

    const dropoff = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      detector: "funnel_dropoff",
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const struggle = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      detector: "observed_struggle",
      surface: "/checkout/address",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const logger = createRecordingDeliveryLogger();
    const [lane] = await createDeliveryLaneSource({ db, logger }).listDueLanes(NOW);

    const labelsFor = (findingId: string): readonly string[] | undefined =>
      (lane?.candidates ?? [])
        .find((entry) => entry.findingId === findingId)
        ?.message.observations.map((observation) => observation.label);

    expect(labelsFor(dropoff.findingId)).toEqual(["reached this step", "left without continuing"]);
    expect(labelsFor(struggle.findingId)).toEqual(["reached this step", "showed struggle"]);
  } finally {
    await close();
  }
});

test("laneFor excludes a candidate whose signature the ledger resolves as dismissed, even when every other filter would have let it through", async () => {
  const { db, close } = await createTestDb();

  try {
    const workspace = await seedPollableWorkspace(db, { prefix: "o19-dismiss-", now: NOW });
    const ctx = deliveryContextFor(workspace.organizationId, workspace.organizationName);

    await seedSlackConnection(
      db,
      { organizationId: workspace.organizationId, channelId: CHANNEL },
      OWNER_SCHEMA,
    );

    const dismissed = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/payment",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const deliverable = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const decisions = new Map<string, SuppressionDecision | "throw">([
      [dismissed.signature, { decision: "suppress", reason: "dismissed" }],
    ]);

    const logger = createRecordingDeliveryLogger();
    const source = laneSourceWithLedger({ db, logger }, fakeLedgerFor(decisions));
    const [lane] = await source.listDueLanes(NOW);

    const candidateIds = (lane?.candidates ?? []).map((candidate) => candidate.findingId);
    expect(candidateIds).not.toContain(dismissed.findingId);
    // Control — without it, an accidentally-empty `candidates` array would pass the
    // row above too.
    expect(candidateIds).toContain(deliverable.findingId);
  } finally {
    await close();
  }
});

test("holds a candidate back, and only that candidate, when consultSignature throws", async () => {
  const { db, close } = await createTestDb();

  try {
    const laneA = await seedPollableWorkspace(db, { prefix: "o19-throw-a-", now: NOW });
    const ctxA = deliveryContextFor(laneA.organizationId, laneA.organizationName);
    await seedSlackConnection(
      db,
      { organizationId: laneA.organizationId, channelId: `${CHANNEL}A` },
      OWNER_SCHEMA,
    );

    const throwing = await seedFinding(db, ctxA, {
      projectId: laneA.projectId,
      surface: "/checkout/payment",
      context: CLEAN_CONTEXT,
      at: NOW,
    });
    const sibling = await seedFinding(db, ctxA, {
      projectId: laneA.projectId,
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const laneB = await seedPollableWorkspace(db, { prefix: "o19-throw-b-", now: NOW });
    const ctxB = deliveryContextFor(laneB.organizationId, laneB.organizationName);
    await seedSlackConnection(
      db,
      { organizationId: laneB.organizationId, channelId: `${CHANNEL}B` },
      OWNER_SCHEMA,
    );
    const unrelated = await seedFinding(db, ctxB, {
      projectId: laneB.projectId,
      surface: "/checkout/payment",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const decisions = new Map<string, SuppressionDecision | "throw">([
      [throwing.signature, "throw"],
    ]);

    const logger = createRecordingDeliveryLogger();
    const source = laneSourceWithLedger({ db, logger }, fakeLedgerFor(decisions));
    const lanes = await source.listDueLanes(NOW);

    const foundA = lanes.find((entry) => entry.organizationId === laneA.organizationId);
    const foundB = lanes.find((entry) => entry.organizationId === laneB.organizationId);

    const idsA = (foundA?.candidates ?? []).map((candidate) => candidate.findingId);
    expect(idsA).not.toContain(throwing.findingId);
    expect(idsA).toContain(sibling.findingId);

    const idsB = (foundB?.candidates ?? []).map((candidate) => candidate.findingId);
    expect(idsB).toContain(unrelated.findingId);
  } finally {
    await close();
  }
});

test("does not spend a considered slot on a dismissed finding", async () => {
  const { db, close } = await createTestDb();

  try {
    const workspace = await seedPollableWorkspace(db, { prefix: "o19-slot-", now: NOW });
    const ctx = deliveryContextFor(workspace.organizationId, workspace.organizationName);

    await seedSlackConnection(
      db,
      { organizationId: workspace.organizationId, channelId: CHANNEL },
      OWNER_SCHEMA,
    );

    // Oldest first, so it sits past the consideration budget once the dismissed rows
    // are in front of it — the exact arrangement the `text.held` sibling test above
    // uses, mirrored here for a dismissed signature instead of a held one.
    const deliverable = await seedFinding(db, ctx, {
      projectId: workspace.projectId,
      surface: "/checkout/review",
      context: CLEAN_CONTEXT,
      at: NOW,
    });

    const dismissedSignatures: string[] = [];
    for (let index = 0; index < FINDINGS_CONSIDERED_PER_LANE; index += 1) {
      const seeded = await seedFinding(db, ctx, {
        projectId: workspace.projectId,
        surface: "/checkout/payment",
        context: CLEAN_CONTEXT,
        at: NOW,
      });
      dismissedSignatures.push(seeded.signature);
    }

    const decisions = new Map<string, SuppressionDecision | "throw">(
      dismissedSignatures.map((signature) => [
        signature,
        { decision: "suppress", reason: "dismissed" } as SuppressionDecision,
      ]),
    );

    const logger = createRecordingDeliveryLogger();
    const source = laneSourceWithLedger({ db, logger }, fakeLedgerFor(decisions));
    const [lane] = await source.listDueLanes(NOW);

    expect((lane?.candidates ?? []).map((candidate) => candidate.findingId)).toContain(
      deliverable.findingId,
    );
  } finally {
    await close();
  }
}, 60_000);
