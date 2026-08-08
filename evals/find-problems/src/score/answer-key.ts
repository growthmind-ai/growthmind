import { readFileSync } from "node:fs";
import { join } from "node:path";

import { answerKeySchema, type AnswerKey } from "../scenario/types";

export const ANSWER_KEY_FILE = "answers.json";

/** The only reader of answers.json; nothing on the analyser's path imports this module. */
export function loadAnswerKey(directory: string): AnswerKey {
  const raw = readFileSync(join(directory, ANSWER_KEY_FILE), "utf8");
  return answerKeySchema.parse(JSON.parse(raw));
}
