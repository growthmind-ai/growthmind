import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanResidualPii } from "@growthmind/core";
import { SYSTEM_ACTOR_ROLE } from "@growthmind/db/system";
import { createTestDb } from "@growthmind/db/testing";
import { tenantContextSchema, type TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import {
  FINDINGS_CONSIDERED_PER_LANE,
  createDeliveryLaneSource,
} from "../src/delivery-lane-source";
import { DELIVERY_ACTOR_ID } from "../src/tasks/delivery-tick";
import {
  createRecordingDeliveryLogger,
  seedFinding,
  seedSlackConnection,
} from "./helpers/onboarding-delivery-fixtures";
import { seedPollableWorkspace } from "./helpers/wire-fixtures";

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
