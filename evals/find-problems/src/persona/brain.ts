import { readFileSync } from "node:fs";

import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

import type { Observation } from "../protocol";
import type { Persona } from "../scenario/types";

export const PERSONA_ACTIONS = [
  "click",
  "type",
  "press_enter",
  "scroll",
  "back",
  "wait",
  "give_up",
  "done",
] as const;

export const personaDecisionSchema = z.object({
  thinking: z.string().describe("One sentence, first person, on what you are trying right now."),
  feeling: z.enum(["fine", "unsure", "frustrated", "lost"]),
  action: z.enum(PERSONA_ACTIONS),
  elementIndex: z
    .number()
    .int()
    .nullable()
    .describe("Index from the numbered list, or null for actions that need no element."),
  text: z.string().nullable().describe("What to type, when the action is type."),
  reason: z
    .string()
    .nullable()
    .describe("Required for give_up and done: say plainly what stopped you or what you achieved."),
});

export type PersonaDecision = z.infer<typeof personaDecisionSchema>;

export interface StepMemory {
  readonly step: number;
  readonly thinking: string;
  readonly action: string;
  readonly outcome: string;
}

const HISTORY_WINDOW = 6;

const PATIENCE_NOTE: Record<Persona["patience"], string> = {
  low: "You have very little patience. If two attempts in a row do not get you closer, you leave.",
  medium: "You have normal patience. You will try a few things, but you will not grind.",
  high: "You are patient and will keep trying different routes for a while before leaving.",
};

const CONFIDENCE_NOTE: Record<Persona["technicalConfidence"], string> = {
  low: "You are not technical. Words like API key, endpoint, token, SDK, snippet and MCP mean nothing to you, and a screen full of them makes you back off.",
  medium:
    "You are semi-technical. You have shipped a site with a coding assistant but you do not read documentation for fun.",
  high: "You are technical and comfortable with keys, endpoints and config, but your time is expensive.",
};

export function buildPersonaSystemPrompt(persona: Persona): string {
  return [
    `You are a real person using a website for the first time. You are ${persona.label}.`,
    `What you came to do, in your own words: ${persona.intent}`,
    PATIENCE_NOTE[persona.patience],
    CONFIDENCE_NOTE[persona.technicalConfidence],
    "",
    "Each turn you get a screenshot of what is on your screen and a numbered list of the things you could click or type into. Choose one action.",
    "To fill a field, use type with that field's index and the words you want in it. You do not need to click it first.",
    "Nobody has told you how this product works. Do not assume a screen exists because it would be sensible. Work only from what you can see.",
    "You are allowed to leave. If you cannot work out what to do, choose give_up and say plainly what stopped you — that is a real outcome, not a failure.",
    "Choose done only when you believe you have actually finished what you came to do, and say what makes you think so.",
    "Never invent an element index that is not in the list.",
  ].join("\n");
}

function describeElements(observation: Observation): string {
  if (observation.elements.length === 0) return "(nothing you can click or type into)";

  return observation.elements
    .map((element) => {
      const bits = [`[${String(element.index)}]`, element.tag];
      if (element.inputType !== null) bits.push(`type=${element.inputType}`);
      if (element.name.length > 0) bits.push(`"${element.name}"`);
      else if (element.placeholder !== null) bits.push(`placeholder "${element.placeholder}"`);
      if (element.disabled) bits.push("(greyed out)");
      if (element.hasValue) bits.push("(already filled in)");
      return bits.join(" ");
    })
    .join("\n");
}

function describeHistory(history: readonly StepMemory[]): string {
  if (history.length === 0) return "(this is your first move)";
  return history
    .slice(-HISTORY_WINDOW)
    .map((entry) => `${String(entry.step)}. ${entry.action} — ${entry.outcome}`)
    .join("\n");
}

export function buildPersonaPrompt(input: {
  readonly observation: Observation;
  readonly history: readonly StepMemory[];
  readonly facts: Readonly<Record<string, string>>;
}): string {
  const facts = Object.entries(input.facts)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  return [
    `Address bar: ${input.observation.url}`,
    `Page title: ${input.observation.title}`,
    "",
    "Words on the screen:",
    input.observation.visibleText.length === 0
      ? "(the page looks blank)"
      : input.observation.visibleText,
    "",
    "Things you could click or type into:",
    describeElements(input.observation),
    "",
    "What you have already tried:",
    describeHistory(input.history),
    "",
    "Details about you, if a form asks:",
    facts.length === 0 ? "(none)" : facts,
    "",
    "What do you do next?",
  ].join("\n");
}

export interface PersonaBrain {
  decide(input: {
    readonly observation: Observation;
    readonly history: readonly StepMemory[];
    readonly facts: Readonly<Record<string, string>>;
  }): Promise<PersonaDecision>;
}

export function createPersonaBrain(model: LanguageModel, persona: Persona): PersonaBrain {
  const system = buildPersonaSystemPrompt(persona);

  return {
    async decide(input) {
      const screenshot = readFileSync(input.observation.screenshotPath);

      const { object } = await generateObject({
        model,
        schema: personaDecisionSchema,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPersonaPrompt(input) },
              {
                type: "file",
                mediaType: "image/png",
                data: { type: "data", data: new Uint8Array(screenshot) },
              },
            ],
          },
        ],
      });

      return object;
    },
  };
}
