import type { RrwebEvent } from "@growthmind/shared";

import type { NodeIndex } from "../../src/replay/nodes";
import { MAX_ANCESTOR_WALK, indexDomSegments } from "../../src/replay/nodes";
import {
  RRWEB_EVENT_TYPE,
  RRWEB_INCREMENTAL_SOURCE,
  RRWEB_MOUSE_INTERACTION,
  RRWEB_NODE_TYPE,
} from "../../src/replay/parse";

export const BASE_TS = 1_764_000_000_000;

export type Node = Record<string, unknown>;

export function element(
  id: number,
  tagName: string,
  attributes: Readonly<Record<string, string>> = {},
  childNodes: readonly Node[] = [],
): Node {
  return { type: RRWEB_NODE_TYPE.element, id, tagName, attributes, childNodes };
}

// What rrweb writes for a text node under a mask: every non-space character replaced with an
// asterisk. It is here so tests can prove nothing reads it.
export function maskedText(id: number, textContent = "*****"): Node {
  return { type: RRWEB_NODE_TYPE.text, id, textContent };
}

// Text as rrweb records it with masking off, which is the shipped posture (B-050): page chrome
// a developer wrote, verbatim.
export function textNode(id: number, textContent: string): Node {
  return { type: RRWEB_NODE_TYPE.text, id, textContent };
}

export function documentNode(childNodes: readonly Node[]): Node {
  return { type: 0, id: 1, childNodes };
}

export function metaEvent(offsetMs: number, href: string): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.meta,
    timestamp: BASE_TS + offsetMs,
    data: { href, width: 1440, height: 900 },
  };
}

export function snapshotEvent(offsetMs: number, node: Node): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.fullSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { node, initialOffset: { top: 0, left: 0 } },
  };
}

export function mutationEvent(offsetMs: number, adds: readonly Node[] = []): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: {
      source: RRWEB_INCREMENTAL_SOURCE.mutation,
      adds: adds.map((node) => ({ parentId: 1, nextId: null, node })),
      removes: [],
      attributes: [],
      texts: [],
    },
  };
}

function mouseEvent(offsetMs: number, interaction: number, nodeId: number): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { source: RRWEB_INCREMENTAL_SOURCE.mouseInteraction, type: interaction, id: nodeId },
  };
}

export function clickEvent(offsetMs: number, nodeId: number): RrwebEvent {
  return mouseEvent(offsetMs, RRWEB_MOUSE_INTERACTION.click, nodeId);
}

export function doubleClickEvent(offsetMs: number, nodeId: number): RrwebEvent {
  return mouseEvent(offsetMs, RRWEB_MOUSE_INTERACTION.doubleClick, nodeId);
}

export function focusEvent(offsetMs: number, nodeId: number): RrwebEvent {
  return mouseEvent(offsetMs, RRWEB_MOUSE_INTERACTION.focus, nodeId);
}

export function blurEvent(offsetMs: number, nodeId: number): RrwebEvent {
  return mouseEvent(offsetMs, RRWEB_MOUSE_INTERACTION.blur, nodeId);
}

export function inputEvent(offsetMs: number, nodeId: number): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { source: RRWEB_INCREMENTAL_SOURCE.input, id: nodeId, text: "*****", isChecked: false },
  };
}

export function scrollEvent(offsetMs: number, nodeId: number, x: number, y: number): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { source: RRWEB_INCREMENTAL_SOURCE.scroll, id: nodeId, x, y },
  };
}

export function mouseMoveEvent(offsetMs: number): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { source: 1, positions: [] },
  };
}

export const SETTINGS_PAGE = "https://app.growthmind.test/settings";
export const BILLING_PAGE = "https://app.growthmind.test/billing";

export const SUBMIT_NODE_ID = 21;
export const API_KEY_NODE_ID = 22;
export const SCROLL_NODE_ID = 23;
export const LATE_NODE_ID = 91;

export const SUBMIT_TEXT_NODE_ID = 31;

export function settingsSnapshot(offsetMs = 0): RrwebEvent {
  return snapshotEvent(
    offsetMs,
    documentNode([
      element(2, "HTML", {}, [
        element(3, "BODY", {}, [
          element(SUBMIT_NODE_ID, "BUTTON", { class: "gm-submit", id: "save" }, [
            maskedText(SUBMIT_TEXT_NODE_ID),
          ]),
          element(API_KEY_NODE_ID, "INPUT", { name: "apiKey", type: "text" }),
          element(SCROLL_NODE_ID, "DIV", { class: "gm-scroller" }),
        ]),
      ]),
    ]),
  );
}

export const ICON_BUTTON_NODE_ID = 41;
export const ICON_SVG_NODE_ID = 42;
export const ICON_PATH_NODE_ID = 43;
export const LINK_NODE_ID = 44;
export const LINK_TEXT_NODE_ID = 45;
export const BARE_DIV_NODE_ID = 46;

export const DEEP_BUTTON_NODE_ID = 50;
export const DEEP_DIV_NODE_ID = DEEP_BUTTON_NODE_ID + MAX_ANCESTOR_WALK + 1;

function deeplyWrappedButton(): Node {
  let wrapped = element(DEEP_DIV_NODE_ID, "DIV", { class: "gm-deep" });
  for (let nodeId = DEEP_DIV_NODE_ID - 1; nodeId > DEEP_BUTTON_NODE_ID; nodeId -= 1) {
    wrapped = element(nodeId, "DIV", {}, [wrapped]);
  }
  return element(DEEP_BUTTON_NODE_ID, "BUTTON", { class: "gm-deep-button" }, [wrapped]);
}

export function controlsSnapshot(offsetMs = 0): RrwebEvent {
  return snapshotEvent(
    offsetMs,
    documentNode([
      element(2, "HTML", {}, [
        element(3, "BODY", {}, [
          element(ICON_BUTTON_NODE_ID, "BUTTON", { class: "gm-icon" }, [
            element(ICON_SVG_NODE_ID, "SVG", {}, [element(ICON_PATH_NODE_ID, "PATH")]),
          ]),
          element(LINK_NODE_ID, "A", { href: "/billing" }, [maskedText(LINK_TEXT_NODE_ID)]),
          element(BARE_DIV_NODE_ID, "DIV", { class: "gm-plain" }),
          deeplyWrappedButton(),
        ]),
      ]),
    ]),
  );
}

// The shapes Mantine actually renders, taken from apps/web/app/(auth)/sign-in/sign-in-form.tsx
// and the digest of a real recording of it: a hash class and a generated id on every control,
// the field's name only in the label bound to it, and the button's text two spans down.
export const SIGN_IN_LABEL_NODE_ID = 61;
export const SIGN_IN_EMAIL_NODE_ID = 62;
export const SIGN_IN_BUTTON_NODE_ID = 63;
export const SIGN_IN_HEADING_NODE_ID = 64;
export const SIGN_IN_DIVIDER_NODE_ID = 65;

export const SIGN_IN_EMAIL_ELEMENT_ID = "mantine-0zhpcizrb";
export const SIGN_IN_EMAIL_CLASSES = "m_8fb7ebe7 mantine-Input-input mantine-TextInput-input";

export function signInSnapshot(offsetMs = 0): RrwebEvent {
  return snapshotEvent(
    offsetMs,
    documentNode([
      element(2, "HTML", {}, [
        element(3, "BODY", {}, [
          element(SIGN_IN_HEADING_NODE_ID, "H1", { class: "m_8a5d1357" }, [
            textNode(101, "Sign in"),
          ]),
          element(
            SIGN_IN_LABEL_NODE_ID,
            "LABEL",
            {
              class: "m_8fdc1311 mantine-InputWrapper-label",
              for: SIGN_IN_EMAIL_ELEMENT_ID,
            },
            [textNode(102, "Email")],
          ),
          element(SIGN_IN_EMAIL_NODE_ID, "INPUT", {
            class: SIGN_IN_EMAIL_CLASSES,
            id: SIGN_IN_EMAIL_ELEMENT_ID,
            type: "email",
            placeholder: "you@company.com",
            autocomplete: "email",
          }),
          element(SIGN_IN_DIVIDER_NODE_ID, "DIV", { class: "mantine-Divider-label" }, [
            textNode(103, "or"),
          ]),
          element(
            SIGN_IN_BUTTON_NODE_ID,
            "BUTTON",
            {
              class: "m_77c9d27d mantine-Button-root",
              type: "submit",
            },
            [
              element(104, "SPAN", { class: "mantine-Button-inner" }, [
                element(105, "SPAN", { class: "mantine-Button-label" }, [textNode(106, "Sign in")]),
              ]),
            ],
          ),
        ]),
      ]),
    ]),
  );
}

export function lastSegmentIndex(events: readonly RrwebEvent[]): NodeIndex {
  return indexDomSegments(events).at(-1)?.index ?? new Map();
}
