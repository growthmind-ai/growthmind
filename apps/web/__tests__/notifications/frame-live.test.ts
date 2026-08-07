// The frame's live invalidation wire (ADD D-3, UX row 10, the O-026 frozen-subtree class):
// the layout computes the bell snapshot per render, passes it to AppFrame as a required
// prop, and mounts LiveRefresh — beside the data it invalidates, never inside the client
// frame. Source-level in the publisher-test style, with planted controls so each scan is
// proven able to fail. RED in Wave 0: today's layout mounts no LiveRefresh and passes no
// bell prop.
import { describe, expect, test } from "bun:test";

import { readSourceUnderConstruction } from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const LAYOUT_OWNER = "O-051 task 3.3 (apps/web/app/(app)/layout.tsx + AppFrame bell prop, ADD D-3)";

const layoutSource = (): string =>
  readSourceUnderConstruction({
    repoRelativePath: "apps/web/app/(app)/layout.tsx",
    ownedBy: LAYOUT_OWNER,
  });

const appFrameSource = (): string =>
  readSourceUnderConstruction({
    repoRelativePath: "apps/web/components/app/AppFrame.tsx",
    ownedBy: LAYOUT_OWNER,
  });

// The mount and its topic, in one expression: `router.refresh()` must re-run the layout
// that computed the prop, so the mount lives in the layout's own render.
const LIVE_REFRESH_WITH_NOTIFICATIONS = /<LiveRefresh\b[^>]*topics=\{\s*\[[^\]]*"notifications"/;

const BELL_PROP_PASSED = /\bbell=\{/;

// Required, not optional: a `bell?:` is a wire a caller can forget (O-026 — the required
// field is the cheapest wire).
const OPTIONAL_BELL_PROP = /\bbell\?:/;
const DECLARED_BELL_PROP = /\bbell:/;

const CLEAN_LAYOUT = `
  return (
    <>
      <AppFrame groups={groups} bell={bell}>
        {children}
      </AppFrame>
      <LiveRefresh topics={["notifications"]} />
    </>
  );
`;

const LAYOUT_WITHOUT_WIRE = `
  return (
    <AppFrame groups={groups}>
      {children}
    </AppFrame>
  );
`;

const LAYOUT_WRONG_TOPIC = `
  return (
    <>
      <AppFrame groups={groups} bell={bell}>{children}</AppFrame>
      <LiveRefresh topics={["first_run"]} />
    </>
  );
`;

describe("the layout mounts the invalidator beside the data it invalidates", () => {
  test("CONTROL: the scans pass a wired layout and fail an unwired or wrong-topic one", () => {
    expect(LIVE_REFRESH_WITH_NOTIFICATIONS.test(CLEAN_LAYOUT)).toBe(true);
    expect(BELL_PROP_PASSED.test(CLEAN_LAYOUT)).toBe(true);

    expect(LIVE_REFRESH_WITH_NOTIFICATIONS.test(LAYOUT_WITHOUT_WIRE)).toBe(false);
    expect(BELL_PROP_PASSED.test(LAYOUT_WITHOUT_WIRE)).toBe(false);
    expect(LIVE_REFRESH_WITH_NOTIFICATIONS.test(LAYOUT_WRONG_TOPIC)).toBe(false);
  });

  test("(app)/layout.tsx mounts <LiveRefresh> with the notifications topic", () => {
    expect(LIVE_REFRESH_WITH_NOTIFICATIONS.test(layoutSource())).toBe(true);
  });

  test("(app)/layout.tsx passes the server-computed bell prop into AppFrame", () => {
    const source = layoutSource();
    expect(source).toContain("<AppFrame");
    expect(BELL_PROP_PASSED.test(source)).toBe(true);
  });

  test("the client frame never mounts its own LiveRefresh — the invalidator lives with the layout's data", () => {
    // Mounted inside AppFrame, router.refresh() re-renders a subtree whose prop never
    // changes — the exact frozen-subtree failure O-026 named.
    expect(appFrameSource()).not.toContain("<LiveRefresh");
  });
});

describe("AppFrame carries the bell as a required prop", () => {
  test("the prop is declared and not optional", () => {
    const source = appFrameSource();
    expect(DECLARED_BELL_PROP.test(source)).toBe(true);
    expect(OPTIONAL_BELL_PROP.test(source)).toBe(false);
  });

  test("CONTROL: the optional-prop scan tells the two declarations apart", () => {
    expect(OPTIONAL_BELL_PROP.test("readonly bell?: BellSnapshot | null;")).toBe(true);
    expect(OPTIONAL_BELL_PROP.test("readonly bell: BellSnapshot | null;")).toBe(false);
    expect(DECLARED_BELL_PROP.test("readonly bell: BellSnapshot | null;")).toBe(true);
  });
});
