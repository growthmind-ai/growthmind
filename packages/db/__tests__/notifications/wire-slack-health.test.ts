// ADD §9 hazard 1 — the forty-times loop. The slack_disconnected notification is itself
// owed, so its own dispatch fails against the same broken connection and calls
// recordHealth('failing') a second time from inside the handler. That loop terminates
// only because the transition gate is a conditional UPDATE that returns no row the second
// time; a counter or a read-then-write spams the org unboundedly. RED in Wave 0:
// recordHealth does not exist yet.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";
import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loadDispatch,
  recordHealthOf,
  refusingPoster,
  silentLogger,
} from "../helpers/o051-contracts";

const NAMES = laneNames("wire-slack-health");

const CHANNEL = "C0HEALTH001";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await stubGraphileAddJob(db);
});

afterAll(async () => {
  await close();
});

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
}

async function slackDisconnectedRows(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "slack_disconnected"),
      ),
    );
}

test("the health notification's own failed dispatch cannot emit a second one", async () => {
  const org = await seedOrg("self-dispatch");
  await connectSlackChannel(db, org, CHANNEL);

  const recordHealth = recordHealthOf(createSlackConnectionsRepo(db, org.ctx));

  const transition = await recordHealth({
    health: "failing",
    reasonCode: "call_failed",
    reasonMessage: null,
    checkedAt: new Date(),
  });
  expect(transition).toBe("entered_failing");

  const alerts = await slackDisconnectedRows(org.organizationId);
  expect(alerts).toHaveLength(1);
  const alert = alerts[0];
  if (!alert) throw new Error("the entered_failing edge emitted nothing");
  expect(alert.subjectKind).toBe("slack_connection");

  // The alert is owed, and the org still holds a delivery target, so a dispatch job for
  // the alert itself was queued — the self-referential post this hazard is about.
  const alertJobs = dispatchJobsOf(await capturedJobs(db)).filter(
    (job) => dispatchPayloadOf(job).notificationId === alert.id,
  );
  expect(alertJobs).toHaveLength(1);
  const alertJob = alertJobs[0];
  if (!alertJob) throw new Error("unreachable: length was asserted above");

  // The REAL handler, against the same broken channel. D-2 makes a retryable failure
  // throw after its receipt commits, so the throw is contract, not a fault of this drive.
  const run = await loadDispatch();
  const refusing = refusingPoster("call_failed");
  await run(alertJob.payload, {
    db,
    posterFor: () => Promise.resolve(refusing.poster),
    logger: silentLogger,
  }).catch(() => undefined);

  expect(refusing.posted).toHaveLength(1);

  // The handler recorded the failure and called recordHealth('failing') again from inside
  // itself; the gate found health already 'failing' and returned no row. One alert, ever.
  expect(await slackDisconnectedRows(org.organizationId)).toHaveLength(1);

  // And the alert's own receipt is the honest failed one, so the bell can say why.
  const receipts = await db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, alert.id));
  expect(receipts.map((row) => [row.status, row.failureReason])).toContainEqual([
    "failed",
    "call_failed",
  ]);
});
