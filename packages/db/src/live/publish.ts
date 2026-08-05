import { LIVE_CHANNEL, logger, type LivePayload } from "@growthmind/shared";
import { sql } from "drizzle-orm";

import { describeDriverError } from "../repositories/driver-error";
import type { ScopedExecutor } from "../repositories/types";

// Told, never asked: the browser learns a thing changed because this fires, and there is no
// timer anywhere that would cover for it if it did not.
//
// A missed publish is not a stuck screen. Every page renders from the database on load, so
// someone arriving after the event already sees the settled state — that is what makes a
// dropped NOTIFY survivable, and the reason nothing polls behind it.
export async function publishLive(db: ScopedExecutor, payload: LivePayload): Promise<void> {
  try {
    await db.execute(sql`select pg_notify(${LIVE_CHANNEL}, ${JSON.stringify(payload)}::text)`);
  } catch (error) {
    // D8: telling a browser is never worth failing the write that had something to tell it.
    logger.error("live: a change could not be published, so open pages will not hear about it", {
      organizationId: payload.organizationId,
      topic: payload.topic,
      reason: describeDriverError(error),
    });
  }
}
