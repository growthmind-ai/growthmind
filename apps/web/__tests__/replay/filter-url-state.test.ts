import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { REPLAY_DEFAULT_LANE, REPLAY_FILTER_PARAMS, replayFiltersOf } from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { ROUTES } from "@/lib/routes";

import { nextReplayUrl } from "../../components/replay/filters/filter-url";

const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SWEPT = ["app", "components", "lib"] as const;

// A param name written out at a call site is D9's silent no-op: the reader keeps parsing
// `company` while the writer starts writing `Company`, and nothing errors.
const RAW_PARAM_CALL = /\.(?:set|append|delete|getAll|get|has)\(\s*["'`](?:company|entry|who)["'`]/;

const BASE = "http://localhost:3000";

const alphabetical = (left: string, right: string): number => left.localeCompare(right);

function filters(overrides: Partial<ReplayFilters> = {}): ReplayFilters {
  return { company: null, entry: null, lane: REPLAY_DEFAULT_LANE, ...overrides };
}

function query(url: string | null): URLSearchParams {
  if (url === null) throw new Error("expected a url, got null");
  return new URL(url, BASE).searchParams;
}

function pathnameOf(url: string | null): string {
  if (url === null) throw new Error("expected a url, got null");
  return new URL(url, BASE).pathname;
}

// The URL the writer produced, read back through the one parser — the round trip the browser
// performs on the next render, and the only proof the two halves agree.
function reparse(url: string | null): ReplayFilters {
  return replayFiltersOf(Object.fromEntries(query(url).entries()));
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("the URL is the durable state", () => {
  test("a founder applying a filter writes a URL carrying only the three known params", () => {
    const one = nextReplayUrl(filters(), REPLAY_FILTER_PARAMS.company, "acme.com");

    expect(pathnameOf(one)).toBe(ROUTES.replays);
    expect([...query(one).keys()]).toEqual([REPLAY_FILTER_PARAMS.company]);

    const all = nextReplayUrl(
      filters({ company: "acme.com", entry: "/pricing" }),
      REPLAY_FILTER_PARAMS.who,
      "excluded",
    );

    expect([...query(all).keys()].toSorted(alphabetical)).toEqual(
      [
        String(REPLAY_FILTER_PARAMS.company),
        String(REPLAY_FILTER_PARAMS.entry),
        String(REPLAY_FILTER_PARAMS.who),
      ].toSorted(alphabetical),
    );

    // A path value is a value, not a second path segment: it survives the round trip verbatim.
    expect(reparse(all).entry).toBe("/pricing");
  });

  // A6 / T8. Clearing the page filter must not throw away the company the founder chose two
  // clicks earlier — the demo's "Show everything" is the behaviour this asserts against.
  test("a founder clearing one filter drops that param only", () => {
    const url = nextReplayUrl(
      filters({ company: "acme.com", entry: "/pricing", lane: "excluded" }),
      REPLAY_FILTER_PARAMS.entry,
      null,
    );

    const params = query(url);

    expect(params.has(REPLAY_FILTER_PARAMS.entry)).toBe(false);
    expect(params.get(REPLAY_FILTER_PARAMS.company)).toBe("acme.com");
    expect(params.get(REPLAY_FILTER_PARAMS.who)).toBe("excluded");
  });

  // T10 / FR-3. The default lane is a stated baseline, so /replays and /replays?who=real must
  // be the same first paint — which they only are if the baseline is never written.
  test("a founder returning to the default lane drops the who param rather than writing who=real", () => {
    const url = nextReplayUrl(
      filters({ company: "acme.com", lane: "excluded" }),
      REPLAY_FILTER_PARAMS.who,
      REPLAY_DEFAULT_LANE,
    );

    expect(query(url).has(REPLAY_FILTER_PARAMS.who)).toBe(false);
    expect(url ?? "").not.toContain(`${REPLAY_FILTER_PARAMS.who}=${REPLAY_DEFAULT_LANE}`);
    expect(query(url).get(REPLAY_FILTER_PARAMS.company)).toBe("acme.com");

    // And from the baseline, picking the baseline again is not a navigation at all.
    expect(nextReplayUrl(filters(), REPLAY_FILTER_PARAMS.who, REPLAY_DEFAULT_LANE)).toBeNull();
  });

  // D3. Two rapid clicks on one option must not stack two history entries. The guarantee is
  // structural rather than behavioural: the second apply has no URL to push.
  test("a founder double-clicking one option produces one URL and one history entry", () => {
    const start = filters({ lane: "excluded" });

    const first = nextReplayUrl(start, REPLAY_FILTER_PARAMS.company, "acme.com");
    expect(first).not.toBeNull();

    const second = nextReplayUrl(reparse(first), REPLAY_FILTER_PARAMS.company, "acme.com");
    expect(second).toBeNull();

    // The same rule on the way out: clearing a filter that is already absent is a no-op too.
    expect(nextReplayUrl(start, REPLAY_FILTER_PARAMS.entry, null)).toBeNull();
  });

  test("no call site names a filter param with a raw string literal", () => {
    const offenders: string[] = [];

    for (const directory of SWEPT) {
      for (const file of sourceFiles(path.join(WEB_ROOT, directory))) {
        if (RAW_PARAM_CALL.test(readFileSync(file, "utf8"))) {
          offenders.push(path.relative(WEB_ROOT, file).replaceAll("\\", "/"));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
