// FR-4.2: this outcome ships no UI at all. The readout is pushed to the channel the founder
// already reads, and a per-feature stats view is the anti-persona's ask — so the scan is over
// the sprint's own diff rather than over a promise in a document.
//
// RED in Wave 0 by design: the guard below refuses to declare a diff UI-free until that diff
// actually carries production source. A no-UI scan over a diff of nothing but test files is
// green about an empty set, which is the failure mode every other non-vacuity check here
// exists to prevent.
import { describe, expect, test } from "bun:test";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const APP_ROUTES_PREFIX = "apps/web/app/(app)/";

function git(args: readonly string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT });

  if (run.exitCode !== 0) {
    throw new Error(
      `no-ui scan: \`git ${args.join(" ")}\` exited ${String(run.exitCode)}. ` +
        `The scan cannot report a clean diff it was never able to read. ` +
        `stderr: ${new TextDecoder().decode(run.stderr).trim()}`,
    );
  }

  return new TextDecoder().decode(run.stdout);
}

interface DiffEntry {
  readonly status: string;
  readonly path: string;
}

// On a PR, origin/main sits behind HEAD and this comparison is the sprint's actual diff. CI also
// runs this same suite on push to main, where the PR has already been squash-merged and HEAD *is*
// origin/main — that comparison is empty by construction, not because the sprint shipped nothing.
// Fall back to the commit that just landed there, which (being a squash merge) is the whole PR.
function diffBase(): string {
  const head = git(["rev-parse", "HEAD"]).trim();
  const mainTip = git(["rev-parse", "origin/main"]).trim();
  return head === mainTip ? "HEAD~1" : "origin/main";
}

// Committed against the merge base, plus whatever is still in the working tree, so a wave that
// has not committed yet cannot pass this by being invisible to it.
function sprintDiff(): readonly DiffEntry[] {
  const entries = new Map<string, string>();
  const base = diffBase();

  for (const line of git(["diff", "--name-status", `${base}...HEAD`]).split("\n")) {
    const parts = line.trim().split(/\s+/);
    const status = parts[0];
    const path = parts[parts.length - 1];
    if (status === undefined || path === undefined || path.length === 0 || parts.length < 2) {
      continue;
    }
    entries.set(path.replaceAll("\\", "/"), status);
  }

  for (const line of git(["status", "--porcelain"]).split("\n")) {
    if (line.trim().length === 0) continue;
    const status = line.slice(0, 2).trim();
    const path = line.slice(3).trim().replaceAll("\\", "/");
    if (path.length === 0) continue;
    entries.set(path, status === "??" ? "A" : status);
  }

  return [...entries].map(([path, status]) => ({ path, status }));
}

function isTestFile(path: string): boolean {
  return path.includes("__tests__/") || /\.test\.tsx?$/.test(path);
}

const DIFF = sprintDiff();

describe("the sprint adds no page and no component", () => {
  test("the diff carries production source, so the no-UI claim is about something", () => {
    expect(DIFF.length).toBeGreaterThan(0);

    const source = DIFF.filter(
      (entry) => !isTestFile(entry.path) && /\.(ts|tsx)$/.test(entry.path),
    );

    expect(source.map((entry) => entry.path)).not.toEqual([]);
  });

  test("no file in the diff is a component", () => {
    const components = DIFF.filter((entry) => entry.path.endsWith(".tsx"));

    expect(components.map((entry) => entry.path)).toEqual([]);
  });

  test("no file is added under the signed-in app's routes", () => {
    const added = DIFF.filter(
      (entry) => entry.status.startsWith("A") && entry.path.startsWith(APP_ROUTES_PREFIX),
    );

    expect(added.map((entry) => entry.path)).toEqual([]);
  });

  test("the scanners fire on a planted control, so a clean report is a real one", () => {
    const planted: readonly DiffEntry[] = [
      { status: "A", path: `${APP_ROUTES_PREFIX}shipped/page.tsx` },
      { status: "M", path: "apps/web/components/shipped/ShippedCard.tsx" },
    ];

    expect(planted.filter((entry) => entry.path.endsWith(".tsx"))).toHaveLength(2);
    expect(
      planted.filter(
        (entry) => entry.status.startsWith("A") && entry.path.startsWith(APP_ROUTES_PREFIX),
      ),
    ).toHaveLength(1);
    expect(planted.filter((entry) => isTestFile(entry.path))).toHaveLength(0);
  });
});
