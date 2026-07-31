// deliveries repository (O-007) — the persistence behind two clauses of the
// outcome's definition of done: "duplicate delivery is idempotent (D4)" and
// "a Slack delivery failure never breaks the pipeline's persisted state (D8)".
//
// Every test below runs real SQL against the real generated migrations via
// `createTestDb()`'s PGlite instance. That is the point: the idempotency
// guarantee is a UNIQUE INDEX and an `ON CONFLICT … WHERE` predicate, and
// neither of those can be proven by a fake.
//
// Reading order, by the taxonomy dimension each block pins:
//   D4  duplicate delivery is idempotent — one row, one post-ownership claim
//   D6  two concurrent claims — exactly one wins
//   D3  one finding, two channels — two independent posts, not one
//   D7  cross-tenant — org B reads and mutates nothing of org A's; a
//       non-owner TEAMMATE of org A can read
//   D8  failure isolation — a failed delivery leaves the finding deliverable,
//       corrupts nothing else, and every pending row can reach a terminal
//       state
//   D2  stamp/filter symmetry — every column a read filters on is stamped by
//       the write
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import {
  createDeliveriesRepo,
  type ClaimDeliveryInput,
} from "../../src/repositories/deliveries.repo";
import type { SignatureHex } from "../../src/signatures/hex";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  makeTenantContext,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../helpers/fixtures";

// This suite is about the repository's atomicity and scoping, not the
// `SignatureHex` brand's validation contract (`hex.test.ts` owns that), so a
// well-formed hex literal is cast directly rather than routed through the
// constructor — the same shortcut `finding-signatures.repo.test.ts` takes.
function testSignature(hex: string): SignatureHex {
  return hex as unknown as SignatureHex;
}

const CHANNEL = "C0FINDINGS";
const OTHER_CHANNEL = "C0ENGINEERING";
const CLAIMED_AT = new Date("2026-07-31T09:00:00.000Z");

function makeClaimInput(
  projectId: string,
  overrides: Partial<ClaimDeliveryInput> = {},
): ClaimDeliveryInput {
  return {
    projectId,
    findingId: "finding-1",
    signature: testSignature("a".repeat(64)),
    channelId: CHANNEL,
    claimedAt: CLAIMED_AT,
    ...overrides,
  };
}

describe("deliveries repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- D4: duplicate delivery is idempotent ---------------------------------

  it("creates one row and grants post ownership exactly once when the same finding is delivered to the same channel twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-claim-twice",
      userName: "Owner Claim Twice",
      email: "owner-claim-twice@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-claim-twice",
    });
    const repo = createDeliveriesRepo(db, org.ctx);
    const input = makeClaimInput(project.id);

    const first = await repo.claimForPost(input);
    // The retry — a re-queued Graphile Worker job, an overlapping scheduler
    // tick, a duplicate webhook. It must NOT come back owning the post.
    const second = await repo.claimForPost(input);

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);

    // ONE row, settled by the unique index — never by a prior read.
    expect(second.delivery?.id).toBe(first.delivery?.id);
    // And the blocked claim did not touch the row it lost to: `attempts`
    // counts real post attempts, not times asked.
    expect(second.delivery?.attempts).toBe(1);
    expect(second.delivery?.status).toBe("pending");

    const pending = await repo.listPendingForProject(project.id);
    expect(pending).toHaveLength(1);
  });

  it("does not move posted_at or message_ref when the same delivery is confirmed posted twice", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-posted-twice",
      userName: "Owner Posted Twice",
      email: "owner-posted-twice@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-posted-twice",
    });
    const repo = createDeliveriesRepo(db, org.ctx);
    await repo.claimForPost(makeClaimInput(project.id));

    const firstPostedAt = new Date("2026-07-31T10:00:00.000Z");
    const secondPostedAt = new Date("2026-07-31T11:00:00.000Z");

    const first = await repo.markPosted({
      findingId: "finding-1",
      channelId: CHANNEL,
      postedAt: firstPostedAt,
      messageRef: "1785481299.000100",
    });
    // A replayed confirmation, with a LATER instant and a different reference
    // — the `coalesce(...)` exists to guard against exactly this.
    const second = await repo.markPosted({
      findingId: "finding-1",
      channelId: CHANNEL,
      postedAt: secondPostedAt,
      messageRef: "1785481299.999999",
    });

    expect(first?.postedAt?.getTime()).toBe(firstPostedAt.getTime());
    expect(second?.postedAt?.getTime()).toBe(firstPostedAt.getTime());
    // The reference of the message that ACTUALLY shipped is the one that
    // stands — overwriting it would point a later thread reply at nothing.
    expect(second?.messageRef).toBe("1785481299.000100");
    expect(second?.status).toBe("posted");
  });

  // --- D6: two concurrent claims, exactly one wins ---------------------------

  it("never grants post ownership to two concurrent claims for the same finding", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-claim-concurrent",
      userName: "Owner Claim Concurrent",
      email: "owner-claim-concurrent@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-claim-concurrent",
    });
    const repo = createDeliveriesRepo(db, org.ctx);
    const input = makeClaimInput(project.id, { findingId: "finding-concurrent" });

    // Two overlapping scheduler ticks racing the same claim. If ownership
    // were decided by a read-then-write ("does a delivery exist yet?"), both
    // would conclude "no" and the customer would get the finding twice.
    const [first, second] = await Promise.all([repo.claimForPost(input), repo.claimForPost(input)]);

    const owners = [first, second].filter((result) => result.claimed);
    expect(owners).toHaveLength(1);

    // And exactly one row exists to show for it.
    const pending = await repo.listPendingForProject(project.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBe(1);
  });

  // --- D3: one finding, two channels ----------------------------------------

  it("treats the same finding delivered to two different channels as two independent posts", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-two-channels",
      userName: "Owner Two Channels",
      email: "owner-two-channels@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-two-channels",
    });
    const repo = createDeliveriesRepo(db, org.ctx);

    const toFindings = await repo.claimForPost(makeClaimInput(project.id));
    const toEngineering = await repo.claimForPost(
      makeClaimInput(project.id, { channelId: OTHER_CHANNEL }),
    );

    // `channel_id` is inside the unique tuple, so a second channel is a
    // second legitimate post — not a duplicate to be suppressed.
    expect(toFindings.claimed).toBe(true);
    expect(toEngineering.claimed).toBe(true);
    expect(toEngineering.delivery?.id).not.toBe(toFindings.delivery?.id);

    const pending = await repo.listPendingForProject(project.id);
    expect(pending.map((row) => row.channelId).toSorted()).toEqual(
      [CHANNEL, OTHER_CHANNEL].toSorted(),
    );
  });

  // --- D7: cross-tenant -----------------------------------------------------

  it("returns null when another org reads a delivery it does not own", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-xt-read-a",
      userName: "Owner XT Read A",
      email: "owner-xt-read-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-xt-read-b",
      userName: "Owner XT Read B",
      email: "owner-xt-read-b@acme.example",
    });
    const projectA = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-xt-read-a",
    });
    const repoA = createDeliveriesRepo(db, orgA.ctx);
    const repoB = createDeliveriesRepo(db, orgB.ctx);
    const signature = testSignature("b".repeat(64));

    const claimed = await repoA.claimForPost(
      makeClaimInput(projectA.id, { findingId: "finding-xt-read", signature }),
    );
    expect(claimed.claimed).toBe(true);

    // Org B naming org A's finding, channel, project, and signature — every
    // read answers null / empty, never org A's row.
    expect(await repoB.findFor("finding-xt-read", CHANNEL)).toBeNull();
    expect(await repoB.findLatestForSignature(projectA.id, signature)).toBeNull();
    expect(await repoB.listPendingForProject(projectA.id)).toEqual([]);

    // Org A still sees its own.
    expect((await repoA.findFor("finding-xt-read", CHANNEL))?.id).toBe(claimed.delivery?.id);
  });

  it("changes nothing when another org tries to mark posted or failed on a delivery it does not own", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-xt-write-a",
      userName: "Owner XT Write A",
      email: "owner-xt-write-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-xt-write-b",
      userName: "Owner XT Write B",
      email: "owner-xt-write-b@acme.example",
    });
    const projectA = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-xt-write-a",
    });
    const repoA = createDeliveriesRepo(db, orgA.ctx);
    const repoB = createDeliveriesRepo(db, orgB.ctx);

    await repoA.claimForPost(makeClaimInput(projectA.id, { findingId: "finding-xt-write" }));

    // `null`, not a silent success — the mutation is keyed on the full
    // `(organization_id, finding_id, channel_id)` tuple, so org B's context
    // matches no row at all.
    expect(
      await repoB.markPosted({
        findingId: "finding-xt-write",
        channelId: CHANNEL,
        postedAt: new Date("2026-07-31T10:00:00.000Z"),
        messageRef: "1785481299.111111",
      }),
    ).toBeNull();
    expect(
      await repoB.markFailed({
        findingId: "finding-xt-write",
        channelId: CHANNEL,
        failedAt: new Date("2026-07-31T10:00:00.000Z"),
        reason: "Org B should never be able to write this.",
      }),
    ).toBeNull();

    // Org A's row is byte-for-byte where it was left.
    const untouched = await repoA.findFor("finding-xt-write", CHANNEL);
    expect(untouched?.status).toBe("pending");
    expect(untouched?.postedAt).toBeNull();
    expect(untouched?.failedAt).toBeNull();
    expect(untouched?.failureReason).toBeNull();
    expect(untouched?.messageRef).toBeNull();
  });

  it("lets a non-owner teammate of the same org read the delivery its owner claimed", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-teammate",
      userName: "Owner Teammate",
      email: "owner-teammate@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-teammate",
    });
    const teammate = await seedUser(db, {
      name: "Teammate Not Owner",
      email: "teammate-not-owner@acme.example",
    });
    await seedMember(db, {
      organizationId: org.organizationId,
      userId: teammate.id,
      role: "member",
    });
    const teammateCtx = makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });
    const signature = testSignature("c".repeat(64));

    const ownerRepo = createDeliveriesRepo(db, org.ctx);
    const teammateRepo = createDeliveriesRepo(db, teammateCtx);

    const claimed = await ownerRepo.claimForPost(
      makeClaimInput(project.id, { findingId: "finding-teammate", signature }),
    );

    // D1/D2: a delivery is ORG-scoped, not owner-scoped. Every org member
    // sees it, or the teammate watching the channel cannot tell why a post
    // did or did not happen.
    expect((await teammateRepo.findFor("finding-teammate", CHANNEL))?.id).toBe(
      claimed.delivery?.id,
    );
    expect((await teammateRepo.findLatestForSignature(project.id, signature))?.id).toBe(
      claimed.delivery?.id,
    );
    expect(await teammateRepo.listPendingForProject(project.id)).toHaveLength(1);
  });

  it("keeps the same finding id under a different org as a separate row", async () => {
    const orgA = await seedOrgWithOwner(db, {
      orgName: "acme-xt-separate-a",
      userName: "Owner XT Separate A",
      email: "owner-xt-separate-a@acme.example",
    });
    const orgB = await seedOrgWithOwner(db, {
      orgName: "acme-xt-separate-b",
      userName: "Owner XT Separate B",
      email: "owner-xt-separate-b@acme.example",
    });
    const projectA = await seedProject(db, {
      organizationId: orgA.organizationId,
      name: "checkout-xt-separate-a",
    });
    const projectB = await seedProject(db, {
      organizationId: orgB.organizationId,
      name: "checkout-xt-separate-b",
    });
    const repoA = createDeliveriesRepo(db, orgA.ctx);
    const repoB = createDeliveriesRepo(db, orgB.ctx);
    const sharedInput = { findingId: "finding-shared-id", channelId: CHANNEL };

    const a = await repoA.claimForPost(makeClaimInput(projectA.id, sharedInput));
    const b = await repoB.claimForPost(makeClaimInput(projectB.id, sharedInput));

    // `organization_id` leads the unique tuple, so org B's claim is its own
    // post — never a duplicate suppressed by org A's row.
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
    expect(a.delivery?.id).not.toBe(b.delivery?.id);
    expect(a.delivery?.organizationId).toBe(orgA.organizationId);
    expect(b.delivery?.organizationId).toBe(orgB.organizationId);
  });

  // --- D8: failure isolation -------------------------------------------------

  it("leaves the finding deliverable after a failed post, and the retry re-claims the same row", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-failed-retry",
      userName: "Owner Failed Retry",
      email: "owner-failed-retry@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-failed-retry",
    });
    const repo = createDeliveriesRepo(db, org.ctx);

    // A second, unrelated delivery in the same project — the "corrupts no
    // other persisted state" half of the D8 clause.
    const bystander = await repo.claimForPost(
      makeClaimInput(project.id, {
        findingId: "finding-bystander",
        channelId: OTHER_CHANNEL,
        signature: testSignature("d".repeat(64)),
      }),
    );
    if (!bystander.claimed) {
      throw new Error("the bystander delivery was not claimed");
    }

    const claimed = await repo.claimForPost(
      makeClaimInput(project.id, { findingId: "finding-failed-retry" }),
    );
    const failedAt = new Date("2026-07-31T10:00:00.000Z");
    const failed = await repo.markFailed({
      findingId: "finding-failed-retry",
      channelId: CHANNEL,
      failedAt,
      reason: "Slack did not accept the message.",
    });

    expect(failed?.status).toBe("failed");
    expect(failed?.failedAt?.getTime()).toBe(failedAt.getTime());
    expect(failed?.failureReason).toBe("Slack did not accept the message.");

    // The failure is TERMINAL — the row is no longer pending, so the
    // scheduler does not read it as "one already open" forever.
    const pendingAfterFailure = await repo.listPendingForProject(project.id);
    expect(pendingAfterFailure.map((row) => row.id)).toEqual([bystander.delivery.id]);

    // ...and the finding is still DELIVERABLE: the retry re-claims the same
    // row rather than minting a second one that could post twice.
    const retry = await repo.claimForPost(
      makeClaimInput(project.id, {
        findingId: "finding-failed-retry",
        claimedAt: new Date("2026-07-31T11:00:00.000Z"),
      }),
    );
    expect(retry.claimed).toBe(true);
    expect(retry.delivery?.id).toBe(claimed.delivery?.id);
    expect(retry.delivery?.attempts).toBe(2);
    expect(retry.delivery?.status).toBe("pending");
    // The stale failure is cleared — the row describes the CURRENT attempt.
    expect(retry.delivery?.failedAt).toBeNull();
    expect(retry.delivery?.failureReason).toBeNull();

    // Nothing about the failure, or the retry, touched the other delivery.
    const untouched = await repo.findFor("finding-bystander", OTHER_CHANNEL);
    expect(untouched?.id).toBe(bystander.delivery.id);
    expect(untouched?.status).toBe("pending");
    expect(untouched?.attempts).toBe(1);
    expect(untouched?.failureReason).toBeNull();
  });

  it("does not let a late failure overwrite a delivery Slack already accepted", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-late-failure",
      userName: "Owner Late Failure",
      email: "owner-late-failure@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-late-failure",
    });
    const repo = createDeliveriesRepo(db, org.ctx);
    await repo.claimForPost(makeClaimInput(project.id, { findingId: "finding-late-failure" }));

    const postedAt = new Date("2026-07-31T10:00:00.000Z");
    await repo.markPosted({
      findingId: "finding-late-failure",
      channelId: CHANNEL,
      postedAt,
      messageRef: "1785481299.222222",
    });

    // A timeout unwinding after the post already succeeded. If this were
    // allowed to land, the row would become `failed`, `claimForPost` would
    // re-claim it, and the customer would see the finding a second time.
    const late = await repo.markFailed({
      findingId: "finding-late-failure",
      channelId: CHANNEL,
      failedAt: new Date("2026-07-31T10:00:05.000Z"),
      reason: "The request timed out.",
    });
    expect(late).toBeNull();

    const persisted = await repo.findFor("finding-late-failure", CHANNEL);
    expect(persisted?.status).toBe("posted");
    expect(persisted?.postedAt?.getTime()).toBe(postedAt.getTime());
    expect(persisted?.failureReason).toBeNull();

    // And a re-claim is still refused, because the row never left `posted`.
    const reclaim = await repo.claimForPost(
      makeClaimInput(project.id, { findingId: "finding-late-failure" }),
    );
    expect(reclaim.claimed).toBe(false);
    expect(reclaim.delivery?.status).toBe("posted");
  });

  it("lets every pending delivery reach a terminal state, so nothing is left open", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-terminal-states",
      userName: "Owner Terminal States",
      email: "owner-terminal-states@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-terminal-states",
    });
    const repo = createDeliveriesRepo(db, org.ctx);

    await repo.claimForPost(makeClaimInput(project.id, { findingId: "finding-happy-exit" }));
    await repo.claimForPost(
      makeClaimInput(project.id, {
        findingId: "finding-sad-exit",
        channelId: OTHER_CHANNEL,
      }),
    );
    expect(await repo.listPendingForProject(project.id)).toHaveLength(2);

    // The two exit paths a delivery attempt actually has. Both are writable
    // from `pending`; neither is a dead end.
    const posted = await repo.markPosted({
      findingId: "finding-happy-exit",
      channelId: CHANNEL,
      postedAt: new Date("2026-07-31T10:00:00.000Z"),
      messageRef: "1785481299.333333",
    });
    const failed = await repo.markFailed({
      findingId: "finding-sad-exit",
      channelId: OTHER_CHANNEL,
      failedAt: new Date("2026-07-31T10:00:00.000Z"),
      reason: "We could not reach Slack.",
    });

    expect(posted?.status).toBe("posted");
    expect(failed?.status).toBe("failed");
    // Nothing stuck. A row still pending here is the jam described in
    // `packages/shared/src/delivery/types.ts` — silence to the customer,
    // "one already open" to the scheduler, forever.
    expect(await repo.listPendingForProject(project.id)).toEqual([]);
  });

  // --- D2: stamp/filter symmetry ---------------------------------------------

  it("stamps every column its read paths filter on", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: "acme-stamp-filter",
      userName: "Owner Stamp Filter",
      email: "owner-stamp-filter@acme.example",
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: "checkout-stamp-filter",
    });
    const repo = createDeliveriesRepo(db, org.ctx);
    const signature = testSignature("e".repeat(64));

    const claimed = await repo.claimForPost(
      makeClaimInput(project.id, { findingId: "finding-stamp-filter", signature }),
    );
    // Narrowed rather than optional-chained: this test is about columns being
    // PRESENT, and `?.` on an unclaimed result would let every assertion below
    // pass vacuously against `undefined`.
    if (!claimed.claimed) {
      throw new Error("claimForPost did not grant ownership of the first claim");
    }

    // The five columns the reads narrow by, all written by the ONE write
    // path. A filter on a column the write never stamps matches zero rows —
    // a guaranteed-empty read that looks like "no deliveries yet", not an
    // error (D2, and the incident that rule was written from).
    expect(claimed.delivery.organizationId).toBe(org.organizationId);
    expect(claimed.delivery.projectId).toBe(project.id);
    expect(claimed.delivery.findingId).toBe("finding-stamp-filter");
    expect(claimed.delivery.channelId).toBe(CHANNEL);
    expect(claimed.delivery.signature).toBe(signature);
    expect(claimed.delivery.status).toBe("pending");

    // And each read that filters on them actually finds the row.
    expect((await repo.findFor("finding-stamp-filter", CHANNEL))?.id).toBe(claimed.delivery.id);
    expect((await repo.findLatestForSignature(project.id, signature))?.id).toBe(
      claimed.delivery.id,
    );
    expect((await repo.listPendingForProject(project.id))[0]?.id).toBe(claimed.delivery.id);
  });
});
