import { describeSchemaStatus, getSchemaStatus, type ScopedDb } from "@growthmind/db";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getPostHogClient } from "@/lib/posthog-server";

import { logger } from "@growthmind/shared";
export const dynamic = "force-dynamic";

export interface HealthRouteDeps {
  readonly db: ScopedDb;
  readonly onDegraded?: (() => Promise<void>) | undefined;
}

export async function handle(deps: HealthRouteDeps): Promise<Response> {
  try {
    const detail = describeSchemaStatus(await getSchemaStatus(deps.db));

    if (detail) {
      logger.error(`health check: ${detail}`);
      return NextResponse.json(
        { status: "degraded", database: "ok", schema: "behind", detail },
        { status: 503 },
      );
    }

    return NextResponse.json({ status: "ok", database: "ok", schema: "ok" });
  } catch (error) {
    logger.error("health check: database unreachable", { error });
    await deps.onDegraded?.().catch((notifyError: unknown) => {
      logger.error("health check: degraded notification failed", { error: notifyError });
    });
    return NextResponse.json(
      { status: "degraded", database: "unreachable", schema: "unknown" },
      { status: 503 },
    );
  }
}

export function GET(): Promise<Response> {
  return handle({
    db: getDb(),
    onDegraded: async () => {
      const posthog = getPostHogClient();
      if (!posthog) return;
      posthog.capture({
        distinctId: "system",
        event: "health_check_degraded",
        properties: { database: "unreachable" },
      });
      await posthog.flush();
    },
  });
}
