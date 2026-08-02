import { ping } from "@growthmind/db";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getPostHogClient } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ping(getDb());
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("health check: database unreachable", error);
    const posthog = getPostHogClient();
    if (posthog) {
      posthog.capture({
        distinctId: "system",
        event: "health_check_degraded",
        properties: { database: "unreachable" },
      });
      await posthog.flush();
    }
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
