import { REPLAY_DEFAULT_LANE } from "@growthmind/shared";
import type { ReplayFilters, ReplaySessionFact } from "@growthmind/shared";

export const AUG_1 = new Date("2026-08-01T09:00:00.000Z");
export const AUG_2 = new Date("2026-08-02T09:00:00.000Z");
export const AUG_3 = new Date("2026-08-03T09:00:00.000Z");

export function fact(overrides: Partial<ReplaySessionFact> = {}): ReplaySessionFact {
  return {
    sessionKey: "ph:rec-0001",
    startedAt: AUG_1,
    identityEmailDomain: "acme.com",
    entryUrlPath: "/pricing",
    origin: "real",
    exclusionReason: "none",
    durationSeconds: null,
    activeSeconds: null,
    clickCount: null,
    keypressCount: null,
    consoleErrorCount: null,
    ...overrides,
  };
}

export function facts(
  count: number,
  build: (index: number) => Partial<ReplaySessionFact>,
): readonly ReplaySessionFact[] {
  const out: ReplaySessionFact[] = [];
  for (let index = 0; index < count; index += 1) out.push(fact(build(index)));
  return out;
}

export function filtersOf(overrides: Partial<ReplayFilters> = {}): ReplayFilters {
  return { company: null, entry: null, lane: REPLAY_DEFAULT_LANE, ...overrides };
}
