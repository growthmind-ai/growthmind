import type { RrwebEvent } from "@growthmind/shared";

import { RRWEB_EVENT_TYPE, RRWEB_INCREMENTAL_SOURCE } from "../../src/replay/parse";
import type { Node } from "./fixtures";
import { BASE_TS, documentNode, element, snapshotEvent } from "./fixtures";
import type { Add, Remove } from "./reaction-fixtures";
import { clickOn, domMutation } from "./reaction-fixtures";

// Node ids, tags, attributes and both hrefs below are verbatim from the corpus-3 recording of
// s-vibe-builder, the run B-060 was reported from, pruned to the nodes the walk reads.
export const NAV_ORIGIN = "https://app.growthmind.test";
export const NAV_SIGN_IN_PAGE = `${NAV_ORIGIN}/sign-in`;
export const NAV_SIGN_UP_PAGE = `${NAV_ORIGIN}/sign-up`;

// The OAuth start URL from the corpus-3 recording of s-engineer-in-a-hurry, which reached a
// rendered digest whole. Its `state` is one of ours and carried a user id and an org id, so the
// payload and client id here are replaced with obvious fakes; everything else is the real shape,
// including the `eyJ…` the scan fires on.
export const OAUTH_URL_WITH_SIGNED_STATE =
  "https://slack.com/workspace-signin?redir=%2Foauth%3Fclient_id%3D0000000000000.0000000000000" +
  "0%26scope%3Dchannels%253Aread%252Cgroups%253Aread%252Cchat%253Awrite%26user_scope%3D%26redi" +
  "rect_uri%3Dhttps%253A%252F%252Fapp.growthmind.test%252Fapi%252Ffirst-run%252Fslack%252Foaut" +
  "h%252Fcallback%26state%3DeyJ2IjoxLCJ1IjoiRkFLRVVTRVJJRE5PVFJFQUwwMDAwMDAwIiwibyI6Im9yZy0wMD" +
  "AwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJuIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwM" +
  "DAwMDAwMDAwIiwieCI6MTcwMDAwMDAwMDAwMH0.FAKESIGNATUREnotarealtoken00000000000%26granular_bot" +
  "_scope%3D1%26single_channel%3D0%26install_redirect%3D%26tracked%3D1%26user_default%3D0%26te" +
  "am%3D%26original_team%3D";

export const OAUTH_URL_LOCATION = "https://slack.com/workspace-signin";

export const CLEAN_URL_WITH_QUERY = `${NAV_ORIGIN}/findings?lane=confirmed&sort=recent`;

export const NAV_BODY_NODE_ID = 67;
export const NAV_SIGN_UP_LINK_NODE_ID = 147;
export const NAV_SIGN_IN_FIELD_NODE_ID = 124;
export const NAV_MOUNTED_FIELD_NODE_ID = 373;
export const NAV_MOUNTED_WRAPPER_NODE_ID = 372;

// rrweb writes this when the event target is not in its mirror — a node id that is not a node.
export const NAV_ABSENT_NODE_ID = -1;

export const NAV_HTML_NODE_ID = 3;

export function signInPageSnapshot(offsetMs: number): RrwebEvent {
  return snapshotEvent(
    offsetMs,
    documentNode([
      element(NAV_HTML_NODE_ID, "html", { lang: "en" }, [
        element(NAV_BODY_NODE_ID, "body", {}, signInPageBody() as Node[]),
      ]),
    ]),
  );
}

export function signInPageBody(): readonly Node[] {
  return [
    element(NAV_SIGN_IN_FIELD_NODE_ID, "input", {
      class: "m_8fb7ebe7 mantine-Input-input",
      id: "mantine-cti65idkz",
      type: "email",
      autocomplete: "email",
    }),
    element(NAV_SIGN_UP_LINK_NODE_ID, "a", {
      class: "mantine-focus-auto m_849cf0da mantine-Anchor-root",
      "data-underline": "hover",
      href: NAV_SIGN_UP_PAGE,
    }),
  ];
}

export const NAV_OTHER_LINK_NODE_ID = 148;

// One href, reached two ways: announced by the recorder as the page a session opened on, and
// activated as a link. Both must answer the same.
export function linkedPageEvents(href: string): readonly RrwebEvent[] {
  return [
    metaOn(0, NAV_SIGN_IN_PAGE),
    snapshotEvent(
      10,
      documentNode([
        element(NAV_HTML_NODE_ID, "html", { lang: "en" }, [
          element(NAV_BODY_NODE_ID, "body", {}, [
            element(NAV_OTHER_LINK_NODE_ID, "a", { class: "gm-link", href }),
          ]),
        ]),
      ]),
    ),
    clickOn(5_000, NAV_OTHER_LINK_NODE_ID),
    domMutation(5_100, signUpPageAdds(), SIGN_UP_PAGE_REMOVES),
  ];
}

export function signUpPageAdds(): readonly Add[] {
  return [
    {
      parentId: NAV_BODY_NODE_ID,
      node: element(NAV_MOUNTED_WRAPPER_NODE_ID, "div", { class: "m_6d731127 mantine-Stack-root" }),
    },
    {
      parentId: NAV_MOUNTED_WRAPPER_NODE_ID,
      node: element(NAV_MOUNTED_FIELD_NODE_ID, "input", {
        class: "m_f2d85dd2 mantine-PasswordInput-innerInput",
        id: "mantine-tv455sixa",
        placeholder: "At least 8 characters",
        autocomplete: "new-password",
        type: "password",
        value: "",
      }),
    },
  ];
}

// The page being rebuilt: children taken off <body> and off <head>, exactly as the recording
// has it. This is the only trace an App Router route change leaves.
export const SIGN_UP_PAGE_REMOVES: readonly Remove[] = [
  { parentId: 4, id: 5 },
  { parentId: NAV_BODY_NODE_ID, id: 68 },
];

export function typedInto(offsetMs: number, nodeId: number, text: string): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { source: RRWEB_INCREMENTAL_SOURCE.input, id: nodeId, text, isChecked: false },
  };
}

export function metaOn(offsetMs: number, href: string): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.meta,
    timestamp: BASE_TS + offsetMs,
    data: { href, width: 1440, height: 900 },
  };
}

// The exact shape of the corpus-3 navigation: a link is clicked, rrweb reports input on a node
// it can no longer place, the page is rebuilt, and the field that just mounted reports its own
// empty value before the person has been anywhere near it.
export function signUpNavigationEvents(): readonly RrwebEvent[] {
  return [
    metaOn(0, NAV_SIGN_IN_PAGE),
    signInPageSnapshot(10),
    clickOn(16_837, NAV_SIGN_UP_LINK_NODE_ID),
    typedInto(16_983, NAV_ABSENT_NODE_ID, ""),
    typedInto(16_983, NAV_ABSENT_NODE_ID, ""),
    domMutation(17_001, signUpPageAdds(), SIGN_UP_PAGE_REMOVES),
    typedInto(17_003, NAV_MOUNTED_FIELD_NODE_ID, ""),
    clickOn(19_616, NAV_MOUNTED_FIELD_NODE_ID),
    typedInto(19_617, NAV_MOUNTED_FIELD_NODE_ID, "*"),
  ];
}
