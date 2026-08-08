import type { RrwebEvent } from "@growthmind/shared";

import {
  RRWEB_EVENT_TYPE,
  RRWEB_INCREMENTAL_SOURCE,
  RRWEB_MOUSE_INTERACTION,
} from "../../src/replay/parse";
import type { Node } from "./fixtures";
import { BASE_TS, documentNode, element, textNode } from "./fixtures";

export type Add = {
  readonly parentId: number;
  readonly node: Node;
};

export type Remove = {
  readonly parentId: number;
  readonly id: number;
};

export function domMutation(
  offsetMs: number,
  adds: readonly Add[],
  removes: readonly Remove[] = [],
): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: {
      source: RRWEB_INCREMENTAL_SOURCE.mutation,
      adds: adds.map((add) => ({ parentId: add.parentId, nextId: null, node: add.node })),
      removes,
      attributes: [],
      texts: [],
    },
  };
}

export function pageOf(body: readonly Node[]): Node {
  return documentNode([element(2, "html", {}, [element(3, "body", {}, body)])]);
}

export function snapshotOf(offsetMs: number, body: readonly Node[]): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.fullSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: { node: pageOf(body), initialOffset: { top: 0, left: 0 } },
  };
}

export function clickOn(offsetMs: number, nodeId: number): RrwebEvent {
  return {
    type: RRWEB_EVENT_TYPE.incrementalSnapshot,
    timestamp: BASE_TS + offsetMs,
    data: {
      source: RRWEB_INCREMENTAL_SOURCE.mouseInteraction,
      type: RRWEB_MOUSE_INTERACTION.click,
      id: nodeId,
    },
  };
}

const MANTINE_BUTTON_CLASS =
  "mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 " +
  "mantine-UnstyledButton-root";
const MANTINE_TEXT_CLASS = "mantine-focus-auto m_b6d8b162 mantine-Text-root";
const MANTINE_STACK_CLASS = "m_6d731127 mantine-Stack-root";

// Node ids, tag names, class strings and copy below are lifted verbatim from two real recordings
// of this app, pruned to the branches that reach the clicked control. Both were driven through
// the production path and both produced a finding that could not see the words on the screen.

export const SIGN_IN_FORM_NODE_ID = 118;
export const SIGN_IN_STACK_NODE_ID = 119;
export const SIGN_IN_BUTTON_NODE_ID = 139;
export const SIGN_IN_BUTTON_LABEL_NODE_ID = 141;
export const SIGN_IN_ERROR_NODE_ID = 306;

export const SIGN_IN_ERROR_TEXT = "That email and password don't match — try again?";

export function signInFormBody(): readonly Node[] {
  return [
    element(SIGN_IN_FORM_NODE_ID, "form", { novalidate: "" }, [
      element(SIGN_IN_STACK_NODE_ID, "div", { class: MANTINE_STACK_CLASS }, [
        element(138, "div", { style: "position:relative", class: "" }, [
          element(
            SIGN_IN_BUTTON_NODE_ID,
            "button",
            { class: MANTINE_BUTTON_CLASS, "data-size": "md", type: "submit" },
            [
              element(140, "span", { class: "m_80f1301b mantine-Button-inner" }, [
                element(
                  SIGN_IN_BUTTON_LABEL_NODE_ID,
                  "span",
                  { class: "m_811560b9 mantine-Button-label" },
                  [textNode(142, "Sign in")],
                ),
              ]),
            ],
          ),
        ]),
      ]),
    ]),
  ];
}

export function signInErrorAdds(text: string = SIGN_IN_ERROR_TEXT): readonly Add[] {
  return [
    {
      parentId: SIGN_IN_STACK_NODE_ID,
      node: element(SIGN_IN_ERROR_NODE_ID, "p", { class: MANTINE_TEXT_CLASS, "data-size": "sm" }),
    },
    { parentId: SIGN_IN_ERROR_NODE_ID, node: textNode(307, text) },
  ];
}

export const CONNECT_STACK_NODE_ID = 591;
export const CONNECT_INNER_STACK_NODE_ID = 598;
export const CONNECT_BUTTON_NODE_ID = 601;
export const CONNECT_BUTTON_LABEL_NODE_ID = 620;
export const CONNECT_STYLE_NODE_ID = 602;
export const CONNECT_REFUSAL_NODE_ID = 776;

export const CONNECT_REFUSAL_TEXT =
  "We could not read what you sent. Send it as a JSON object with the fields this step asks " +
  "for — and when a step asks for nothing, an empty one.";

export const CONNECT_SELF_HOSTED_TEXT = "Running PostHog at an address of your own?";

// The <style> element Mantine writes its responsive rules into sits beside the button, so a CSS
// rule lands inside the interacted control's own ancestry on every render.
export const CONNECT_STYLE_TEXT =
  ".__m__-_r_6f_{width:100%;}@media(min-width: 36em){.__m__-_r_6f_{width:auto;}}";

export function connectFormBody(): readonly Node[] {
  return [
    element(CONNECT_STACK_NODE_ID, "div", { class: MANTINE_STACK_CLASS }, [
      element(CONNECT_INNER_STACK_NODE_ID, "div", { class: MANTINE_STACK_CLASS }, [
        element(CONNECT_BUTTON_NODE_ID, "button", { class: MANTINE_BUTTON_CLASS, type: "button" }, [
          element(619, "span", { class: "m_80f1301b mantine-Button-inner" }, [
            element(
              CONNECT_BUTTON_LABEL_NODE_ID,
              "span",
              { class: "m_811560b9 mantine-Button-label" },
              [textNode(621, "Connect")],
            ),
          ]),
        ]),
        element(CONNECT_STYLE_NODE_ID, "style"),
      ]),
    ]),
  ];
}

export function connectRefusalAdds(): readonly Add[] {
  return [
    {
      parentId: CONNECT_INNER_STACK_NODE_ID,
      node: element(773, "div", { class: MANTINE_STACK_CLASS }),
    },
    {
      parentId: 773,
      node: element(774, "div", { class: "", "aria-hidden": "true", inert: "" }),
    },
    { parentId: CONNECT_STYLE_NODE_ID, node: textNode(775, CONNECT_STYLE_TEXT) },
    {
      parentId: CONNECT_STACK_NODE_ID,
      node: element(CONNECT_REFUSAL_NODE_ID, "p", { class: MANTINE_TEXT_CLASS, "data-size": "sm" }),
    },
    {
      parentId: CONNECT_REFUSAL_NODE_ID,
      node: textNode(777, CONNECT_REFUSAL_TEXT),
    },
    {
      parentId: 773,
      node: element(778, "button", { class: MANTINE_BUTTON_CLASS, type: "button" }),
    },
    { parentId: 778, node: element(779, "span", { class: "m_80f1301b mantine-Button-inner" }) },
    { parentId: 779, node: element(780, "span", { class: "m_811560b9 mantine-Button-label" }) },
    { parentId: 780, node: textNode(781, CONNECT_SELF_HOSTED_TEXT) },
  ];
}

export const CONNECT_STYLE_REMOVES: readonly Remove[] = [
  { parentId: CONNECT_STYLE_NODE_ID, id: 770 },
];
