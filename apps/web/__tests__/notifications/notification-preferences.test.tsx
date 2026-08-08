// The settings card (UX o-051-health-and-first-config, First-Run rows 1–10): four things
// the workspace decides, one thing nobody decides, two things only the viewer decides —
// with the boundary stated twice, straddling the seam. RED in Wave 0: the component
// renders null. Static markup carries no handlers, so the optimistic-save contract is
// pinned at source level, the job-1 bell.test.tsx harness shape.
import { MantineProvider } from "@mantine/core";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MutableNotificationClass } from "@growthmind/shared";

import { readSourceUnderConstruction } from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  NotificationPreferences,
  type NotificationPreferencesProps,
} from "../../components/settings/NotificationPreferences";
import { theme } from "../../lib/theme";
import { readMarkup } from "../first-run/helpers/rendered-markup";

const CARD_OWNER =
  "O-051 task 4.2 (apps/web/components/settings/NotificationPreferences.tsx, UX Variant 1)";
const CARD_SOURCE = "apps/web/components/settings/NotificationPreferences.tsx";
const PAGE_SOURCE = "apps/web/app/(app)/settings/page.tsx";

// UX §Copy, PROPOSED strings built against verbatim (a swap on sign-off is cheap). The
// health line carries its own reason deliberately: without the second sentence it reads
// as a limitation, with it a promise — cutting it re-opens the disabled-control trap.
const HEALTH_LABEL = "Health and security";
const HEALTH_BODY =
  "Always sent, to everyone in this workspace. A broken Slack connection or a new key is not something to find out about late.";
const BELL_LABEL = "Your bell";
const BELL_BODY = "Only you see this. Turning something off here changes nothing for anyone else.";
const WORK_LABEL = "The work";
const WORK_DESCRIPTION = "Findings and fixes, and anything waiting on you.";
const RECORD_LABEL = "The record";
const RECORD_DESCRIPTION = "Things that happened that need nothing from you.";
const ALWAYS_LINE = "Health and security always show here, whichever of these is off.";
const CADENCE_SELECT_LABEL = "How often";
const DAY_SELECT_LABEL = "Which day";
const NO_SLACK_SUMMARY_TAIL = "It will go to Slack once a channel is connected.";
const OFF_SUMMARY = "No weekly summary. Anything urgent still arrives straight away.";

const BOTH_CLASSES: readonly MutableNotificationClass[] = ["work", "record"];

function withoutStyleBlocks(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style>/g, "");
}

function checkboxInputsOf(html: string): readonly string[] {
  return (html.match(/<input\b[^>]*>/g) ?? []).filter((tag) => tag.includes('type="checkbox"'));
}

function render(props: Partial<NotificationPreferencesProps> = {}): {
  html: string;
  text: string;
  controls: readonly string[];
} {
  const html = withoutStyleBlocks(
    renderToStaticMarkup(
      createElement(
        MantineProvider,
        { theme },
        createElement(NotificationPreferences, {
          cadence: "weekly",
          day: "monday",
          shown: BOTH_CLASSES,
          channelLabel: "growth",
          ...props,
        }),
      ),
    ),
  );
  const read = readMarkup(html);
  return { html, text: read.text, controls: read.controls };
}

// Entity-decoded through readMarkup, the rendered card text must carry the string; the
// raw-html slices below avoid apostrophes for the same reason job 1's fixtures did.
describe("the health line is a sentence, not a control (First-Run row 4 — the sprint's easiest thing to build wrong)", () => {
  test("the guarantee renders as prose carrying its own reason, and no control is labelled with it", () => {
    const { text, controls } = render();

    expect(text).toContain(HEALTH_LABEL);
    expect(text).toContain(HEALTH_BODY);

    expect(controls.some((label) => label.includes(HEALTH_LABEL))).toBe(false);
  });

  test("the health region holds no input, button, select, or disabled anything", () => {
    const { html } = render();

    const healthAt = html.indexOf("Always sent, to everyone in this workspace");
    expect(healthAt).toBeGreaterThan(-1);

    const bellAt = html.indexOf("Only you see this");
    expect(bellAt).toBeGreaterThan(healthAt);

    const healthRegion = html.slice(healthAt, bellAt);
    expect(healthRegion).not.toContain("<input");
    expect(healthRegion).not.toContain("<button");
    expect(healthRegion).not.toContain("<select");
    expect(healthRegion).not.toContain("disabled");
    expect(healthRegion).not.toContain("aria-disabled");
  });
});

describe("the org/personal seam (First-Run rows 5–6)", () => {
  test("the four workspace blocks sit above the seam and the viewer's two below it, each side owning its sentence", () => {
    const { html } = render();

    const healthAt = html.indexOf("Always sent, to everyone in this workspace");
    const bellAt = html.indexOf("Only you see this");
    expect(healthAt).toBeGreaterThan(-1);
    expect(bellAt).toBeGreaterThan(-1);

    // The 48px rule renders as Mantine's Divider — a separator between the two ownership
    // statements, so the boundary is visible exactly where the copy states it twice.
    const seamAt = html.indexOf('role="separator"', healthAt);
    expect(seamAt).toBeGreaterThan(healthAt);
    expect(seamAt).toBeLessThan(bellAt);
  });

  test("both lead-ins render as the matched pair the seam straddles", () => {
    const { text } = render();

    expect(text).toContain(BELL_LABEL);
    expect(text).toContain(BELL_BODY);
    expect(text).toContain(HEALTH_LABEL);
  });
});

describe("cadence off removes the day select from the layout (First-Run row 9)", () => {
  test("at weekly the day select is present with its visible label", () => {
    const { text } = render({ cadence: "weekly" });

    expect(text).toContain(CADENCE_SELECT_LABEL);
    expect(text).toContain(DAY_SELECT_LABEL);
  });

  test("at off the day select is absent — removed, never disabled", () => {
    const { html, text } = render({ cadence: "off" });

    expect(text).toContain(CADENCE_SELECT_LABEL);
    expect(text).not.toContain(DAY_SELECT_LABEL);
    expect(html).not.toContain("disabled");

    expect(text).toContain(OFF_SUMMARY);
  });
});

describe("the terminal states keep their promises (First-Run rows 3, 7, 10)", () => {
  test("both mutes off still promises health and security in the closing line", () => {
    const { html, text } = render({ shown: [] });

    expect(text).toContain(WORK_LABEL);
    expect(text).toContain(WORK_DESCRIPTION);
    expect(text).toContain(RECORD_LABEL);
    expect(text).toContain(RECORD_DESCRIPTION);
    expect(text).toContain(ALWAYS_LINE);

    const boxes = checkboxInputsOf(html);
    expect(boxes).toHaveLength(2);
    expect(boxes.filter((tag) => tag.includes("checked"))).toHaveLength(0);
  });

  test("both classes shown renders both checkboxes checked", () => {
    const { html } = render({ shown: BOTH_CLASSES });

    const boxes = checkboxInputsOf(html);
    expect(boxes).toHaveLength(2);
    expect(boxes.filter((tag) => tag.includes("checked"))).toHaveLength(2);
  });

  test("with no Slack the summary promises a future delivery, never a current one", () => {
    const { text } = render({ channelLabel: null });

    expect(text).toContain(NO_SLACK_SUMMARY_TAIL);
    expect(text).not.toContain("goes to #");

    // The guarantee holds with no Slack — it is about the bell too (UX §7).
    expect(text).toContain(HEALTH_BODY);
  });
});

describe("every control is live for a member who set nothing up (the P-4 anti-regression, rows 1–10)", () => {
  test("defaults render both selects and both checkboxes with no disabled state and no permissions sentence", () => {
    const { html, text } = render();

    expect(text).toContain(CADENCE_SELECT_LABEL);
    expect(text).toContain(DAY_SELECT_LABEL);
    expect(checkboxInputsOf(html)).toHaveLength(2);

    expect(html).not.toContain("disabled");
    expect(html).not.toContain("aria-disabled");
    expect(text.toLowerCase()).not.toContain("admin");
    expect(text.toLowerCase()).not.toContain("permission");
  });
});

describe("the save contract and the widths are pinned at source (rows 8 and the 375/1280 walk's unit half)", () => {
  test("saves are optimistic in the PageRoles mold: shipped notices, stamp tone, no second copy, no red", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: CARD_SOURCE,
      ownedBy: CARD_OWNER,
    });

    expect(source).toContain("PAGES_SAVED");
    expect(source).toContain("PAGES_SAVE_FAILED");
    expect(source).toContain("stamp.4");

    expect(source).not.toContain("That did not save");
    expect(source).not.toContain('c="red"');
  });

  test("controls carry the shipped full-width-at-mobile shape and the tap-target floor", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: CARD_SOURCE,
      ownedBy: CARD_OWNER,
    });

    expect(source).toContain('base: "100%"');
    expect(source).toContain("tapTargetStyle");
  });

  // The claim was "the section keeps its registry title", written when Delivery was a
  // titled Section. That section is now a ConnectionCard that names itself, so the title
  // constant is gone from main. What survives is the structural half: these controls live
  // inside the Slack connection's own card — one card, not a second one beside it.
  test("the preferences mount inside the delivery connection's card, not beside it", () => {
    const page = readSourceUnderConstruction({
      repoRelativePath: PAGE_SOURCE,
      ownedBy: CARD_OWNER,
    });

    const delivery = page.slice(page.indexOf("function Delivery"));
    const card = delivery.slice(0, delivery.indexOf("</ConnectionCard>"));

    expect(card).toContain("<NotificationPreferences");
    expect(page).not.toContain("settingsDeliveryGroup");
  });
});
