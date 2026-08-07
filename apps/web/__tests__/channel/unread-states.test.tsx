// A read that failed must not offer a repair. `connectionStateOf` used to infer "Slack is
// disconnected" from the exact value a failed read returned, and the page drew a Reconnect
// Slack control beside it — a wrong claim plus a destructive action, for a connection nobody
// had managed to look at. These assert the failure arms carry no control at all, with the
// working arms beside them so the scan cannot pass by finding nothing anywhere.
import { MantineProvider } from "@mantine/core";
import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ConnectionBanner,
  EmptyRecord,
  LaneUnavailable,
  RecordUnavailable,
} from "../../components/channel/ChannelStates";
import { EmptyState } from "../../components/fixes/EmptyState";
import {
  CONNECTION_UNREAD_HEAD,
  LANE_UNREAD,
  RECORD_UNREAD_HEAD,
} from "../../components/channel/unread";
import { LIST_UNAVAILABLE_BODY, LIST_UNAVAILABLE_HEADING } from "../../lib/fixes/view";
import { theme } from "../../lib/theme";
import { readMarkup } from "../first-run/helpers/rendered-markup";

function render(element: ReactElement): { readonly text: string; readonly controls: string[] } {
  const html = renderToStaticMarkup(createElement(MantineProvider, { theme }, element));
  const read = readMarkup(html);

  return { text: read.text, controls: [...read.controls] };
}

describe("the /channel arms a failed read reaches", () => {
  test("an unreadable connection states itself and offers nothing to press", () => {
    const shown = render(
      <ConnectionBanner connection={{ kind: "unavailable" }} recordUnread={false} />,
    );

    expect(shown.text).toContain(CONNECTION_UNREAD_HEAD);
    expect(shown.controls).toEqual([]);
    expect(shown.text).not.toContain("Reconnect Slack");
    expect(shown.text).not.toContain("Slack is disconnected");
  });

  test("CONTROL: a genuinely disconnected workspace still gets its repair", () => {
    const shown = render(
      <ConnectionBanner connection={{ kind: "disconnected" }} recordUnread={false} />,
    );

    expect(shown.controls).toEqual(["Reconnect Slack →"]);
    expect(shown.text).toContain("Everything below reached your team before that.");
  });

  test("a disconnect read against an unreadable record drops the clause the record would prove", () => {
    const shown = render(<ConnectionBanner connection={{ kind: "disconnected" }} recordUnread />);

    expect(shown.text).not.toContain("Everything below reached your team");
    expect(shown.text).toContain("Nothing new can arrive until someone reconnects it.");
  });

  test("an unreadable record is a statement, not an empty record and not a call to action", () => {
    const shown = render(<RecordUnavailable />);

    expect(shown.text).toContain(RECORD_UNREAD_HEAD);
    expect(shown.text).not.toContain("Nothing has arrived yet — that is expected");
    expect(shown.controls).toEqual([]);
  });

  test("an unreadable connection over an empty record never invites a connect", () => {
    const shown = render(<EmptyRecord connection={{ kind: "unavailable" }} />);

    expect(shown.controls).toEqual([]);
    expect(shown.text).not.toContain("Connect Slack");
  });

  test("CONTROL: a workspace that has genuinely never connected is still invited to", () => {
    const shown = render(<EmptyRecord connection={{ kind: "never_connected" }} />);

    expect(shown.controls).toEqual(["Connect Slack"]);
  });

  test("an unreadable lane says so rather than borrowing the never-checked line", () => {
    const shown = render(<LaneUnavailable />);

    expect(shown.text).toBe(LANE_UNREAD);
    expect(shown.text).not.toContain("Nothing is wrong");
    expect(shown.controls).toEqual([]);
  });
});

describe("the /fixes arm a failed read reaches", () => {
  test("an unreadable list states itself and draws no control", () => {
    const shown = render(
      <EmptyState heading={LIST_UNAVAILABLE_HEADING}>{LIST_UNAVAILABLE_BODY}</EmptyState>,
    );

    expect(shown.text).toContain(LIST_UNAVAILABLE_HEADING);
    expect(shown.controls).toEqual([]);
  });

  test("CONTROL: an empty state with a next action still draws it", () => {
    const shown = render(
      <EmptyState heading="Nothing yet" href="/settings" action="Connect your analytics">
        Body
      </EmptyState>,
    );

    expect(shown.controls).toEqual(["Connect your analytics"]);
  });
});
