import type { RrwebEvent } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { stableElementKey } from "../../src/evidence/element-key";
import {
  DESCRIBE_SENTENCE_MAX_LENGTH,
  DESCRIBE_TRUNCATION_MARKER,
  DESCRIBE_VALUE_MAX_LENGTH,
} from "../../src/replay/describe-value";
import { indexDomSegments } from "../../src/replay/nodes";
import {
  PERSISTED_TRANSCRIPT_VERSION,
  readPersistedTranscript,
  rehydratePersistedActions,
  serialisePersistedTranscript,
} from "../../src/replay/persisted-transcript";
import {
  REACTION_WITHHELD_ERROR,
  REACTION_WITHHELD_MESSAGE,
  reactionPhrase,
  renderTranscript,
} from "../../src/replay/render";
import { buildTranscript } from "../../src/replay/transcript";
import type { ReactionAction, SessionAction } from "../../src/replay/types";
import { SETTINGS_PAGE, element, maskedText, metaEvent, textNode } from "./fixtures";
import type { Add } from "./reaction-fixtures";
import {
  CONNECT_BUTTON_LABEL_NODE_ID,
  CONNECT_REFUSAL_TEXT,
  CONNECT_SELF_HOSTED_TEXT,
  CONNECT_STYLE_NODE_ID,
  CONNECT_STYLE_REMOVES,
  CONNECT_STYLE_TEXT,
  SIGN_IN_BUTTON_LABEL_NODE_ID,
  SIGN_IN_BUTTON_NODE_ID,
  SIGN_IN_ERROR_TEXT,
  SIGN_IN_STACK_NODE_ID,
  clickOn,
  connectFormBody,
  connectRefusalAdds,
  domMutation,
  signInErrorAdds,
  signInFormBody,
  snapshotOf,
} from "./reaction-fixtures";

function keyOf(events: readonly RrwebEvent[]): string | null {
  const identity = indexDomSegments(events).at(-1)?.index.get(SIGN_IN_BUTTON_NODE_ID);
  return identity === undefined ? null : (stableElementKey(identity)?.key ?? null);
}

function stored(actions: readonly SessionAction[]): readonly SessionAction[] {
  const written = serialisePersistedTranscript(actions, PERSISTED_TRANSCRIPT_VERSION);
  const read = readPersistedTranscript(JSON.parse(JSON.stringify(written)));

  return read === null ? [] : rehydratePersistedActions(read.actions);
}

function spokenIn(actions: readonly SessionAction[]): readonly SessionAction[] {
  return actions.filter((action) => action.kind === "reaction");
}

function reactionsIn(events: readonly RrwebEvent[]): readonly ReactionAction[] {
  return buildTranscript(events).actions.filter(
    (action): action is ReactionAction => action.kind === "reaction",
  );
}

function linesOf(events: readonly RrwebEvent[]): readonly string[] {
  return renderTranscript(buildTranscript(events)).split("\n");
}

function signInEvents(adds: readonly Add[]): readonly RrwebEvent[] {
  return [
    metaEvent(0, SETTINGS_PAGE),
    snapshotOf(10, signInFormBody()),
    clickOn(5_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
    domMutation(5_200, adds),
  ];
}

function connectEvents(): readonly RrwebEvent[] {
  return [
    metaEvent(0, SETTINGS_PAGE),
    snapshotOf(10, connectFormBody()),
    clickOn(25_000, CONNECT_BUTTON_LABEL_NODE_ID),
    domMutation(25_100, connectRefusalAdds(), CONNECT_STYLE_REMOVES),
  ];
}

describe("what the screen said back reaches the digest", () => {
  test("should carry the sign-in refusal a person read into the beat after the click that caused it", () => {
    const lines = linesOf(signInEvents(signInErrorAdds()));

    expect(lines[1]).toBe("0:05  clicked button[label=Sign in].mantine-focus-auto");
    expect(lines[2]).toBe(`0:05  saw "That email and password don't match — try again?"`);
  });

  test("should carry the first-run connect refusal a person read into the beat after the click", () => {
    const said = reactionsIn(connectEvents()).map((action) => action.text);

    expect(said).toEqual([CONNECT_SELF_HOSTED_TEXT, CONNECT_REFUSAL_TEXT]);
  });

  test("should attribute text to the interaction it followed, never to the one that came next", () => {
    const [reaction] = reactionsIn([
      metaEvent(0, SETTINGS_PAGE),
      snapshotOf(10, signInFormBody()),
      clickOn(5_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
      domMutation(5_200, signInErrorAdds()),
      clickOn(9_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
    ]);

    expect(reaction?.atMs).toBe(5_200);
  });

  test("should say nothing about text the DOM gained before anything was interacted with", () => {
    expect(
      reactionsIn([
        metaEvent(0, SETTINGS_PAGE),
        snapshotOf(10, signInFormBody()),
        domMutation(500, signInErrorAdds()),
      ]),
    ).toEqual([]);
  });
});

describe("a reaction is refused rather than dropped", () => {
  test("should render that the screen answered without repeating a person's data back", () => {
    const carrying = signInErrorAdds("We could not reach someone@example.invalid — check it?");
    const [reaction] = reactionsIn(signInEvents(carrying));

    expect(reaction?.text).toBeUndefined();
    expect(linesOf(signInEvents(carrying))[2]).toBe(`0:05  saw ${REACTION_WITHHELD_MESSAGE}`);
  });

  test("should never render text the recorder masked, and never a beat of asterisks", () => {
    const masked: readonly Add[] = [
      { parentId: SIGN_IN_STACK_NODE_ID, node: element(306, "p", { role: "alert" }) },
      { parentId: 306, node: maskedText(307, "**** ***** *** ******** ***** *****") },
    ];

    expect(linesOf(signInEvents(masked))[2]).toBe(`0:05  saw ${REACTION_WITHHELD_ERROR}`);
    expect(renderTranscript(buildTranscript(signInEvents(masked)))).not.toContain("*");
  });

  test("should repeat the longest message this app actually shows whole, never truncated", () => {
    const longest = CONNECT_REFUSAL_TEXT;
    const [reaction] = reactionsIn(signInEvents(signInErrorAdds(longest)));

    expect(longest.length).toBeGreaterThan(DESCRIBE_VALUE_MAX_LENGTH);
    expect(reaction?.text).toBe(longest);
    expect(reaction?.text).not.toContain(DESCRIBE_TRUNCATION_MARKER);
  });

  test("should still cut text that runs away past what any message needs", () => {
    const runaway = "Sorry, that did not work. ".repeat(20);
    const [reaction] = reactionsIn(signInEvents(signInErrorAdds(runaway)));

    expect(reaction?.text).toHaveLength(DESCRIBE_SENTENCE_MAX_LENGTH);
    expect(reaction?.text?.startsWith("Sorry, that did not work.")).toBe(true);
  });
});

describe("only an answer becomes a beat", () => {
  test("should never read a stylesheet as something a person saw", () => {
    const cssOnly: readonly Add[] = [
      { parentId: CONNECT_STYLE_NODE_ID, node: textNode(775, CONNECT_STYLE_TEXT) },
    ];

    expect(
      reactionsIn([
        metaEvent(0, SETTINGS_PAGE),
        snapshotOf(10, connectFormBody()),
        clickOn(25_000, CONNECT_BUTTON_LABEL_NODE_ID),
        domMutation(25_100, cssOnly),
      ]),
    ).toEqual([]);
  });

  test("should not let a re-render storm bury the beat list", () => {
    const storm: RrwebEvent[] = [];
    for (let tick = 0; tick < 40; tick += 1) {
      storm.push(domMutation(5_100 + tick, signInErrorAdds()));
    }

    const reactions = reactionsIn([
      metaEvent(0, SETTINGS_PAGE),
      snapshotOf(10, signInFormBody()),
      clickOn(5_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
      ...storm,
    ]);

    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.text).toBe(SIGN_IN_ERROR_TEXT);
  });

  test("should treat a container whose contents were swapped out as a page change, not an answer", () => {
    expect(
      reactionsIn([
        metaEvent(0, SETTINGS_PAGE),
        snapshotOf(10, signInFormBody()),
        clickOn(5_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
        domMutation(5_200, signInErrorAdds(), [{ parentId: SIGN_IN_STACK_NODE_ID, id: 138 }]),
      ]),
    ).toEqual([]);
  });

  test("should ignore text that appeared somewhere the person was not and the app never announced", () => {
    const elsewhere: readonly Add[] = [
      { parentId: 3, node: element(900, "div", { class: "gm-sidebar" }) },
      { parentId: 900, node: textNode(901, "Recent activity") },
    ];

    expect(reactionsIn(signInEvents(elsewhere))).toEqual([]);
  });

  test("should read an announced region even when it appeared far from the click", () => {
    const toast: readonly Add[] = [
      { parentId: 3, node: element(900, "div", { role: "alert" }) },
      { parentId: 900, node: textNode(901, "Saving failed. Nothing changed.") },
    ];
    const [reaction] = reactionsIn(signInEvents(toast));

    expect(reaction?.reaction).toBe("error");
    expect(reaction?.text).toBe("Saving failed. Nothing changed.");
  });

  test("should prefer what the app announced over what merely appeared beside the click", () => {
    const both: readonly Add[] = [
      ...signInErrorAdds(),
      { parentId: 3, node: element(900, "div", { "aria-live": "polite" }) },
      { parentId: 900, node: textNode(901, "Signed out everywhere else.") },
    ];

    expect(reactionsIn(signInEvents(both)).map((action) => action.text)).toEqual([
      "Signed out everywhere else.",
    ]);
  });
});

describe("a reaction is about the page, so no element identity moves", () => {
  test("should leave stableElementKey byte-identical to the key the same recording gave before", () => {
    const silent = keyOf([
      metaEvent(0, SETTINGS_PAGE),
      snapshotOf(10, signInFormBody()),
      clickOn(5_000, SIGN_IN_BUTTON_LABEL_NODE_ID),
    ]);

    expect(silent).not.toBeNull();
    expect(keyOf(signInEvents(signInErrorAdds()))).toBe(silent);
  });

  test("should leave a transcript with nothing said back exactly as it rendered before", () => {
    expect(renderTranscript(buildTranscript(signInEvents([])))).toBe(
      [
        "0:00  opened https://app.growthmind.test/settings",
        "0:05  clicked button[label=Sign in].mantine-focus-auto",
        "0:05  session ended",
      ].join("\n"),
    );
  });
});

describe("a stored answer says the same thing when it is read back", () => {
  test("should come back from a stored row saying exactly what it said when it was written", () => {
    const walked = buildTranscript(signInEvents(signInErrorAdds())).actions;

    expect(spokenIn(walked)).toEqual([
      { kind: "reaction", atMs: 5_200, reaction: "message", text: SIGN_IN_ERROR_TEXT },
    ]);
    expect(spokenIn(stored(walked))).toEqual(spokenIn(walked));
  });

  test("should still say the screen answered when a stored row's words are refused on the way out", () => {
    const carrying: SessionAction = {
      kind: "reaction",
      atMs: 5_200,
      reaction: "error",
      text: "We could not reach someone@example.invalid",
    };
    const [read] = stored([carrying]) as readonly ReactionAction[];

    expect(read?.text).toBeUndefined();
    expect(reactionPhrase(read?.reaction ?? "message", read?.text)).toBe(REACTION_WITHHELD_ERROR);
  });

  test("should keep a row that never said anything byte-identical to the row v1 always wrote", () => {
    const silent: readonly SessionAction[] = [
      { kind: "page", atMs: 0, href: SETTINGS_PAGE },
      { kind: "wait", atMs: 2_100, durationMs: 3_000 },
    ];
    const written = serialisePersistedTranscript(silent, PERSISTED_TRANSCRIPT_VERSION);

    expect(JSON.stringify(written)).toBe(
      `{"v":1,"actions":[{"kind":"page","atMs":0,"href":"${SETTINGS_PAGE}"},` +
        `{"kind":"wait","atMs":2100,"durationMs":3000}]}`,
    );
  });
});

describe("an answer sits where it happened in the beat list", () => {
  test("should place the answer after the click that caused it and before the next thing done", () => {
    const kinds = buildTranscript([
      ...connectEvents(),
      clickOn(29_000, CONNECT_BUTTON_LABEL_NODE_ID),
      domMutation(29_100, connectRefusalAdds()),
    ]).actions.map((action) => action.kind);

    expect(kinds).toEqual([
      "page",
      "wait",
      "click",
      "reaction",
      "reaction",
      "click",
      "reaction",
      "reaction",
      "ended",
    ]);
  });
});
