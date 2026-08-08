// CR-5 / ADD D-2: the dispatch enqueue is the one caller that states a cap, and the cap it
// states is the ratified 5. Driven through the real emitters, not a synthetic add_job call,
// so the wire from emit to enqueue is what these tests prove.
import { randomUUID } from "node:crypto";

import { NOTIFICATION_DISPATCH_MAX_ATTEMPTS } from "@growthmind/core";
import {
  buildKeysRevokedDedupKey,
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_RESCUE_TASK,
} from "@growthmind/shared";
import { afterAll, describe, expect, test } from "bun:test";

import { enqueueJob } from "../../src/jobs/enqueue";
import { emitNotification } from "../../src/notifications/emit";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";
import { connectSlackChannel } from "../helpers/o051-contracts";

const NAMES = laneNames("jobs-enqueue");

const COLD_BOOT_BUDGET_MS = 60_000;

// Separate databases on purpose: the fallback case NEEDS the default fixture (no
// graphile_worker schema), and a stub installed on a shared handle would silently turn it
// into the queued path.
const handles: TestDbHandle[] = [];

async function openDb(): Promise<TestDb> {
  const handle = await createTestDb();
  handles.push(handle);
  return handle.db;
}

afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.close()));
});

async function seedConnectedOrg(db: TestDb, label: string): Promise<SeededOrgWithOwner> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  await connectSlackChannel(db, org, "C0ENQUEUE01");
  return org;
}

describe("enqueueJob and the attempt cap it carries", () => {
  test(
    "the savepoint fallback still returns false when the graphile_worker schema is absent",
    async () => {
      const db = await openDb();

      const queued = await enqueueJob(db, {
        task: NOTIFICATION_DISPATCH_TASK,
        payload: { organizationId: "none", notificationId: "none" },
        jobKey: `${NOTIFICATION_DISPATCH_TASK}:${randomUUID()}`,
        maxAttempts: NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
      });

      expect(queued).toBe(false);
    },
    COLD_BOOT_BUDGET_MS,
  );

  test(
    "the dispatch enqueue carries the ratified cap of 5, and other enqueues leave the cap to the runner",
    async () => {
      const db = await openDb();
      await stubGraphileAddJob(db);
      const org = await seedConnectedOrg(db, "cap");

      const eventId = randomUUID();
      const { emitted } = await emitNotification(db, org.organizationId, {
        type: "keys_revoked",
        subjectKind: "agent_key",
        subjectId: eventId,
        actorUserId: org.userId,
        payload: { type: "keys_revoked", v: 1 },
        dedupKey: buildKeysRevokedDedupKey(eventId),
        slack: { kind: "owed" },
      });
      expect(emitted).toBe(true);

      const jobs = await capturedJobs(db);

      const dispatchJobs = jobs.filter((job) => job.task === NOTIFICATION_DISPATCH_TASK);
      expect(dispatchJobs).toHaveLength(1);
      expect(dispatchJobs[0]?.maxAttempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);

      // The ratified magnitude itself, so the constant cannot drift under the tests.
      expect(NOTIFICATION_DISPATCH_MAX_ATTEMPTS).toBe(5);

      // The connect's rescue enqueue is a real non-dispatch caller: it states no cap.
      const rescueJobs = jobs.filter((job) => job.task === NOTIFICATION_RESCUE_TASK);
      expect(rescueJobs.length).toBeGreaterThanOrEqual(1);
      expect(rescueJobs.map((job) => job.maxAttempts)).toEqual(rescueJobs.map(() => null));
    },
    COLD_BOOT_BUDGET_MS,
  );
});
