// The bell and its popover (UX First-Run rows 1–9): every state a P-4 teammate meets,
// asserted against the real components. RED in Wave 0: Bell renders null and the popover
// body export does not exist yet.
//
// Two harness facts shape this file. Mantine's Popover mounts its dropdown in a portal,
// which server-side static markup cannot see — so the popover CONTENT must live in an
// exported `BellPopoverBody` this file renders directly (Wave 4 wraps it in the Popover
// chrome). And static markup carries no event handlers, so the click contracts are pinned
// structurally (true sibling anchors) and at source level (no awaited write); the live
// click behaviour is the qa-spec's browser row.
import { MantineProvider } from "@mantine/core";
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  bellAriaLabel,
  FAILED_CHIP_LABEL,
  MARK_ALL_READ_LABEL,
  NOTIFICATION_EMPTY_STATE_MESSAGES,
  QUIET_NO_CHANNEL_CHIP_LABEL,
  sentChipLabel,
  UNREAD_ROW_SCREEN_READER_PREFIX,
} from "@growthmind/shared";

import {
  loadValueUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { Bell } from "../../components/notifications/Bell";
import type { BellRowViewModel, BellViewModel } from "../../lib/notifications/bell";
import { theme } from "../../lib/theme";
import { readMarkup } from "../first-run/helpers/rendered-markup";

const BODY_OWNER =
  "O-051 task 4.2 (apps/web/components/notifications/BellPopover.tsx — the SSR-visible " +
  "BellPopoverBody export the popover chrome wraps)";
const POPOVER_SOURCE = "apps/web/components/notifications/BellPopover.tsx";

type MirrorBellPopoverBody = (props: { readonly bell: BellViewModel }) => ReactElement | null;

const loadBody = (): Promise<MirrorBellPopoverBody> =>
  loadValueUnderConstruction<MirrorBellPopoverBody>({
    modulePath: underConstructionSpecifier("apps/web/components/notifications/BellPopover"),
    exportName: "BellPopoverBody",
    ownedBy: BODY_OWNER,
  });

// MantineProvider injects `<style>` blocks whose sheets DEFINE the visible-from/hidden-from
// classes, so class-usage scans must read the element markup only — otherwise the scan
// matches the stylesheet and can never pass, whatever the component renders.
function withoutStyleBlocks(html: string): string {
  return html.replace(/<style\b[\s\S]*?<\/style>/g, "");
}

function render(element: ReactElement): { html: string; text: string; controls: string[] } {
  const html = withoutStyleBlocks(
    renderToStaticMarkup(createElement(MantineProvider, { theme }, element)),
  );
  const read = readMarkup(html);
  return { html, text: read.text, controls: [...read.controls] };
}

// Sentences avoid apostrophes so raw-html substring checks need no entity decoding.
const UNREAD_FINDING_ROW: BellRowViewModel = {
  id: "row-finding",
  sentence: "Checkout stalls at the card step for 9 of 41 sessions this week",
  subjectHref: "/findings",
  timeLabel: "2h ago",
  unread: true,
  chip: { kind: "sent", label: sentChipLabel("growth"), href: null },
};

const UNREAD_NET_ROW: BellRowViewModel = {
  id: "row-net",
  sentence: "Every key for this workspace was revoked",
  subjectHref: "/findings",
  timeLabel: "yesterday",
  unread: true,
  chip: { kind: "failed", label: FAILED_CHIP_LABEL, href: "/settings" },
};

const READ_QUIET_ROW: BellRowViewModel = {
  id: "row-quiet",
  sentence: "A coding assistant connected to this workspace for the first time",
  subjectHref: "/agent",
  timeLabel: "Tue",
  unread: false,
  chip: { kind: "quiet", label: QUIET_NO_CHANNEL_CHIP_LABEL, href: "/settings" },
};

function vmWith(overrides: Partial<BellViewModel>): BellViewModel {
  return {
    badgeCount: 0,
    badgeLabel: "0",
    rows: [],
    emptyVariant: null,
    ...overrides,
  };
}

const EMPTY_PRE_SETUP = vmWith({ emptyVariant: "pre_setup" });

interface AnchorShape {
  readonly attrs: string;
  readonly inner: string;
}

function anchorsOf(html: string): AnchorShape[] {
  return [...html.matchAll(/<a\b([^>]*)>((?:(?!<\/a>)[\s\S])*?)<\/a>/g)].map((match) => ({
    attrs: match[1] ?? "",
    inner: match[2] ?? "",
  }));
}

function hasNestedAnchor(html: string): boolean {
  return /<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/.test(html);
}

function buttonWithLabel(html: string, label: string): { attrs: string } | null {
  for (const match of html.matchAll(/<button\b([^>]*)>((?:(?!<\/button>)[\s\S])*?)<\/button>/g)) {
    if ((match[2] ?? "").includes(label)) {
      return { attrs: match[1] ?? "" };
    }
  }
  return null;
}

describe("the bell itself — frame chrome on every page (UX rows 1 and 3)", () => {
  test("renders pre-setup as a real button with the plain aria label and no badge", () => {
    const shown = render(<Bell bell={EMPTY_PRE_SETUP} placement="rail" />);

    expect(shown.html).toContain("<button");
    expect(shown.html).toContain(`aria-label="${bellAriaLabel(0)}"`);
    expect(shown.html).not.toContain("9+");
  });

  test("the aria label carries the honest count: n new below the cap, more than 9 above it", () => {
    const three = render(
      <Bell bell={vmWith({ badgeCount: 3, badgeLabel: "3" })} placement="rail" />,
    );
    expect(three.html).toContain(`aria-label="${bellAriaLabel(3)}"`);

    const capped = render(
      <Bell bell={vmWith({ badgeCount: 12, badgeLabel: "9+" })} placement="rail" />,
    );
    expect(capped.html).toContain(`aria-label="${bellAriaLabel(12)}"`);
    expect(capped.html).toContain("9+");
  });

  test("exactly one bell is visible at any width: rail from sm, bar below sm (P0)", () => {
    const rail = render(<Bell bell={EMPTY_PRE_SETUP} placement="rail" />);
    const bar = render(<Bell bell={EMPTY_PRE_SETUP} placement="bar" />);

    expect(rail.html).toMatch(/visible-from-sm/);
    expect(rail.html).not.toMatch(/hidden-from-sm/);
    expect(bar.html).toMatch(/hidden-from-sm/);
    expect(bar.html).not.toMatch(/visible-from-sm/);
  });

  test("a badge already cleared stays cleared even while rows are unread — the two facts never conflate (row 7)", () => {
    const shown = render(
      <Bell
        bell={vmWith({
          badgeCount: 0,
          badgeLabel: "0",
          rows: [UNREAD_FINDING_ROW, UNREAD_NET_ROW],
        })}
        placement="rail"
      />,
    );

    expect(shown.html).toContain(`aria-label="${bellAriaLabel(0)}"`);
    expect(shown.html).not.toContain("9+");
  });
});

describe("the popover body — every state a teammate meets (UX rows 2, 4, 5, 8, 9)", () => {
  test("empty variants 1–3 carry their exact sentences and only variant 3 invites Connect Slack", async () => {
    const Body = await loadBody();

    const preSetup = render(createElement(Body, { bell: vmWith({ emptyVariant: "pre_setup" }) }));
    expect(preSetup.text).toContain(NOTIFICATION_EMPTY_STATE_MESSAGES.pre_setup);
    expect(preSetup.text).not.toContain(MARK_ALL_READ_LABEL);
    expect(preSetup.controls.join(" ")).not.toContain("Connect Slack");

    const nothingNew = render(
      createElement(Body, { bell: vmWith({ emptyVariant: "nothing_new" }) }),
    );
    expect(nothingNew.text).toContain(NOTIFICATION_EMPTY_STATE_MESSAGES.nothing_new);
    expect(nothingNew.text).not.toContain(MARK_ALL_READ_LABEL);

    const noSlack = render(
      createElement(Body, { bell: vmWith({ emptyVariant: "nothing_new_no_slack" }) }),
    );
    expect(noSlack.text).toContain(NOTIFICATION_EMPTY_STATE_MESSAGES.nothing_new_no_slack);
    expect(noSlack.controls.some((control) => control.includes("Connect Slack"))).toBe(true);
  });

  test("rows read sentence · time · chip, unread rows carry the dot fact and the hidden Unread prefix", async () => {
    const Body = await loadBody();
    const shown = render(
      createElement(Body, {
        bell: vmWith({ rows: [UNREAD_FINDING_ROW, UNREAD_NET_ROW, READ_QUIET_ROW] }),
      }),
    );

    for (const row of [UNREAD_FINDING_ROW, UNREAD_NET_ROW, READ_QUIET_ROW]) {
      expect(shown.text).toContain(row.sentence);
      expect(shown.text).toContain(row.timeLabel);
    }
    expect(shown.text).toContain(FAILED_CHIP_LABEL);
    expect(shown.text).toContain(QUIET_NO_CHANNEL_CHIP_LABEL);
    expect(shown.text).toContain(sentChipLabel("growth"));

    // Two unread rows, two prefixes; the read row carries none (copy #14).
    expect(shown.text.split(UNREAD_ROW_SCREEN_READER_PREFIX).length - 1).toBe(2);
  });

  test("failed and quiet chips are sibling settings links, never nested inside the row link (rows 6/9)", async () => {
    const Body = await loadBody();
    const shown = render(
      createElement(Body, { bell: vmWith({ rows: [UNREAD_NET_ROW, READ_QUIET_ROW] }) }),
    );

    expect(hasNestedAnchor(shown.html)).toBe(false);

    const anchors = anchorsOf(shown.html);
    const rowAnchor = anchors.find((anchor) =>
      anchor.inner.includes("Every key for this workspace was revoked"),
    );
    if (!rowAnchor) throw new Error("the row sentence is not a link to its subject");
    expect(rowAnchor.attrs).toContain('href="/findings"');
    expect(rowAnchor.inner).not.toContain("check the connection");

    const chipAnchor = anchors.find((anchor) => anchor.inner.includes("check the connection"));
    if (!chipAnchor) throw new Error("the failed chip is not a link to the repair");
    expect(chipAnchor.attrs).toContain('href="/settings"');
    expect(chipAnchor.inner).not.toContain("Every key for this workspace was revoked");
  });

  test("the stamp-tone chips never show vendor text or internal codes", async () => {
    const Body = await loadBody();
    const shown = render(
      createElement(Body, { bell: vmWith({ rows: [UNREAD_NET_ROW, READ_QUIET_ROW] }) }),
    );

    for (const internal of [
      "call_failed",
      "not_authorised",
      "channel_unavailable",
      "queue_unavailable",
      "no_channel",
    ]) {
      expect(shown.html).not.toContain(internal);
    }
  });

  test("mark all read is live with dots on screen and inert with none (row 8)", async () => {
    const Body = await loadBody();

    const withDots = render(
      createElement(Body, { bell: vmWith({ rows: [UNREAD_FINDING_ROW, READ_QUIET_ROW] }) }),
    );
    const liveButton = buttonWithLabel(withDots.html, MARK_ALL_READ_LABEL);
    if (!liveButton) throw new Error("no Mark all read control with unread rows on screen");
    expect(/\bdisabled\b/.test(liveButton.attrs)).toBe(false);

    const allRead = render(
      createElement(Body, {
        bell: vmWith({ rows: [{ ...UNREAD_FINDING_ROW, unread: false }, READ_QUIET_ROW] }),
      }),
    );
    const inertButton = buttonWithLabel(allRead.html, MARK_ALL_READ_LABEL);
    if (inertButton !== null) {
      expect(/\bdisabled\b/.test(inertButton.attrs)).toBe(true);
    }
  });
});

describe("the write path never blocks navigation (UX row 6 — the fire-and-forget contract)", () => {
  test("the popover source posts the read but never awaits any fetch", () => {
    const source = readSourceUnderConstruction({
      repoRelativePath: POPOVER_SOURCE,
      ownedBy: BODY_OWNER,
    });

    // The write exists…
    expect(/fetch\(|sendBeacon\(/.test(source)).toBe(true);
    // …and nothing waits on it: navigation is never gated on recording the read.
    expect(/await\s+fetch\(/.test(source)).toBe(false);
  });

  test("CONTROL: the awaited-write scan does catch a blocking implementation", () => {
    const planted = `
      async function onRowClick() {
        await fetch("/api/notifications/bell/read", { method: "POST" });
        router.push(href);
      }
    `;
    expect(/await\s+fetch\(/.test(planted)).toBe(true);
    expect(/fetch\(|sendBeacon\(/.test(planted)).toBe(true);
  });
});
