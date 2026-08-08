import type { RrwebEvent } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { stableElementKey } from "../../src/evidence/element-key";
import { indexDomSegments } from "../../src/replay/nodes";
import { PAGE_WITHHELD_LOCATION, hostOf, renderTranscript } from "../../src/replay/render";
import { buildTranscript } from "../../src/replay/transcript";
import type { SessionAction } from "../../src/replay/types";
import { UNKNOWN_TAG_NAME } from "../../src/replay/nodes";
import { clickOn, domMutation } from "./reaction-fixtures";
import {
  CLEAN_URL_WITH_QUERY,
  OAUTH_URL_LOCATION,
  OAUTH_URL_WITH_SIGNED_STATE,
  linkedPageEvents,
  NAV_ABSENT_NODE_ID,
  NAV_MOUNTED_FIELD_NODE_ID,
  NAV_SIGN_IN_FIELD_NODE_ID,
  NAV_SIGN_IN_PAGE,
  NAV_SIGN_UP_LINK_NODE_ID,
  NAV_SIGN_UP_PAGE,
  SIGN_UP_PAGE_REMOVES,
  metaOn,
  signInPageSnapshot,
  signUpNavigationEvents,
  signUpPageAdds,
  typedInto,
} from "./navigation-fixtures";

function linesOf(events: readonly RrwebEvent[]): readonly string[] {
  return renderTranscript(buildTranscript(events)).split("\n");
}

function typedLines(events: readonly RrwebEvent[]): readonly string[] {
  return linesOf(events).filter((line) => line.includes("typed into"));
}

function pageBeats(events: readonly RrwebEvent[]): readonly SessionAction[] {
  return buildTranscript(events).actions.filter((action) => action.kind === "page");
}

describe("the transcript only says a person typed where a person typed", () => {
  test("should not say a field was typed into when the route change had only just mounted it", () => {
    const typed = typedLines(signUpNavigationEvents());

    expect(typed).toHaveLength(1);
    expect(typed[0]).toContain("0:19");
    expect(typed[0]).toContain("mantine-tv455sixa");
  });

  test("should keep the typing on a field the opening snapshot already held, focus or no focus", () => {
    const typed = typedLines([
      metaOn(0, NAV_SIGN_IN_PAGE),
      signInPageSnapshot(10),
      typedInto(1_000, NAV_SIGN_IN_FIELD_NODE_ID, "e"),
    ]);

    expect(typed).toHaveLength(1);
    expect(typed[0]).toContain("mantine-cti65idkz");
  });

  test("should say a mounted field was typed into once the person has actually reached it", () => {
    const reached = typedLines([
      ...signUpNavigationEvents(),
      typedInto(19_700, NAV_MOUNTED_FIELD_NODE_ID, "**"),
    ]);

    expect(reached).toHaveLength(1);
  });
});

describe("a beat that cannot name its element is not a beat", () => {
  test("should never render the walk's sentinel for a node id no snapshot describes", () => {
    const rendered = renderTranscript(buildTranscript(signUpNavigationEvents()));

    expect(rendered).not.toContain(UNKNOWN_TAG_NAME);
    expect(rendered).not.toContain(String(NAV_ABSENT_NODE_ID));
  });

  test("should drop an input on an absent node rather than describing it as a field", () => {
    const typed = typedLines([
      metaOn(0, NAV_SIGN_IN_PAGE),
      signInPageSnapshot(10),
      typedInto(1_000, NAV_ABSENT_NODE_ID, ""),
    ]);

    expect(typed).toEqual([]);
  });
});

describe("a route change the recorder never announced is still a page", () => {
  test("should count both the page loaded and the page navigated to client-side", () => {
    expect(buildTranscript(signUpNavigationEvents()).pages).toEqual([
      NAV_SIGN_IN_PAGE,
      NAV_SIGN_UP_PAGE,
    ]);
  });

  test("should place the new page directly after the link that opened it", () => {
    const lines = linesOf(signUpNavigationEvents());
    const clicked = lines.findIndex((line) => line.includes("clicked a[href=/sign-up]"));

    expect(clicked).toBeGreaterThan(-1);
    expect(lines[clicked + 1]).toBe(`0:17  opened ${NAV_SIGN_UP_PAGE}`);
  });

  test("should not invent a page for a rebuild no link can be held responsible for", () => {
    const pages = buildTranscript([
      metaOn(0, NAV_SIGN_IN_PAGE),
      signInPageSnapshot(10),
      clickOn(16_837, NAV_SIGN_IN_FIELD_NODE_ID),
      domMutation(17_001, signUpPageAdds(), SIGN_UP_PAGE_REMOVES),
    ]).pages;

    expect(pages).toEqual([NAV_SIGN_IN_PAGE]);
  });

  test("should not report the same page twice when the recorder announces one the walk already read", () => {
    const pages = buildTranscript([
      ...signUpNavigationEvents(),
      metaOn(20_000, NAV_SIGN_UP_PAGE),
    ]).pages;

    expect(pages).toEqual([NAV_SIGN_IN_PAGE, NAV_SIGN_UP_PAGE]);
  });
});

describe("a session that leaves for another origin says so", () => {
  test("should say where a person went rather than letting the recording appear to stop", () => {
    const leaving = [
      metaOn(0, NAV_SIGN_IN_PAGE),
      signInPageSnapshot(10),
      metaOn(20_000, "https://slack.com/workspace-signin"),
    ];

    expect(linesOf(leaving)).toContain("0:20  left for slack.com");
    expect(hostOf(NAV_SIGN_IN_PAGE)).toBe("app.growthmind.test");
  });

  test("should still read a move within one origin as opening a page, not as leaving", () => {
    expect(linesOf(signUpNavigationEvents()).join("\n")).not.toContain("left for");
  });
});

describe("a page beat never repeats a token, and never goes missing instead", () => {
  test("should reduce an OAuth URL to host and path, keeping its signed state out of the digest", () => {
    const events = linkedPageEvents(OAUTH_URL_WITH_SIGNED_STATE);
    const [, opened] = pageBeats(events);
    const rendered = renderTranscript(buildTranscript(events));

    expect(opened?.kind === "page" && opened.href).toBe(OAUTH_URL_LOCATION);
    expect(rendered).not.toContain("eyJ");
    expect(rendered).not.toContain("state");
  });

  test("should still render a clean URL whole, query string and all", () => {
    const rendered = renderTranscript(buildTranscript(linkedPageEvents(CLEAN_URL_WITH_QUERY)));

    expect(rendered).toContain(CLEAN_URL_WITH_QUERY);
  });

  test("should keep the same number of page beats however much of the address survives", () => {
    expect(pageBeats(linkedPageEvents(CLEAN_URL_WITH_QUERY))).toHaveLength(2);
    expect(pageBeats(linkedPageEvents(OAUTH_URL_WITH_SIGNED_STATE))).toHaveLength(2);
    expect(pageBeats(linkedPageEvents("https://someone@example.invalid"))).toHaveLength(2);
  });

  test("should still say a page was opened when no part of the address survives the scan", () => {
    const rendered = renderTranscript(
      buildTranscript(linkedPageEvents("https://someone@example.invalid")),
    );

    expect(rendered).toContain(`opened ${PAGE_WITHHELD_LOCATION}`);
    expect(rendered).not.toContain("example.invalid");
  });

  test("should give the recorder's own announcement the same answer as an activated link", () => {
    const announced = pageBeats([metaOn(0, OAUTH_URL_WITH_SIGNED_STATE), signInPageSnapshot(10)]);
    const activated = pageBeats(linkedPageEvents(OAUTH_URL_WITH_SIGNED_STATE));

    expect(announced[0]?.kind === "page" && announced[0].href).toBe(OAUTH_URL_LOCATION);
    expect(activated[1]?.kind === "page" && activated[1].href).toBe(OAUTH_URL_LOCATION);
  });

  test("should keep a withheld address out of the pages a surface count is built from", () => {
    expect(buildTranscript(linkedPageEvents("https://someone@example.invalid")).pages).toEqual([
      NAV_SIGN_IN_PAGE,
    ]);
  });
});

describe("naming a page changes no element identity", () => {
  test("should leave stableElementKey byte-identical across the route change it now reports", () => {
    const identity = indexDomSegments(signUpNavigationEvents())
      .at(-1)
      ?.index.get(NAV_SIGN_UP_LINK_NODE_ID);
    const before = indexDomSegments([metaOn(0, NAV_SIGN_IN_PAGE), signInPageSnapshot(10)])
      .at(-1)
      ?.index.get(NAV_SIGN_UP_LINK_NODE_ID);

    expect(identity).toBeDefined();
    expect(stableElementKey(identity!)?.key).toBe(stableElementKey(before!)?.key ?? "");
  });
});
