import { ping } from "@growthmind/db";
import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

// Always evaluated at request time — the whole point is a live probe.
export const dynamic = "force-dynamic";

/**
 * Liveness for humans, compose healthchecks, and CI. Reports degraded (503)
 * rather than throwing when Postgres is unreachable, so the difference
 * between "app down" and "database down" is visible from the outside.
 */
export async function GET() {
  try {
    await ping(getDb());
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("health check: database unreachable", error);
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
