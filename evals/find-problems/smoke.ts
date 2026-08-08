import { readFileSync } from "node:fs";

import { buildTranscript, renderTranscript } from "@growthmind/core";
import { rrwebEventSchema } from "@growthmind/shared";

const path = process.argv[2] ?? "runs/session.json";
const recorded = JSON.parse(readFileSync(path, "utf8")) as {
  readonly finalUrl: string;
  readonly consoleErrors: readonly { readonly message: string; readonly url: string }[];
  readonly events: readonly unknown[];
};

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

say(`raw rrweb events: ${String(recorded.events.length)}`);
say(`final url: ${recorded.finalUrl}`);
say(`console errors: ${String(recorded.consoleErrors.length)}`);

const rejected: unknown[] = [];
const parsed = recorded.events.flatMap((event) => {
  const result = rrwebEventSchema.safeParse(event);
  if (!result.success) {
    rejected.push(event);
    return [];
  }
  return [result.data];
});

say(
  `events passing the production schema: ${String(parsed.length)} of ${String(recorded.events.length)}`,
);
if (rejected.length > 0) {
  say(`first rejected event: ${JSON.stringify(rejected[0]).slice(0, 200)}`);
}

const transcript = buildTranscript(parsed);
say(`transcript actions: ${String(transcript.actions.length)}`);
say(`pages: ${transcript.pages.join(", ") || "(none)"}`);
say(`durationMs: ${String(transcript.durationMs)}`);
say(`counts: ${JSON.stringify(transcript.counts)}`);
say("--- digest the narrator would see ---");
say(renderTranscript(transcript));
