import { describe, expect, it } from "bun:test";

import { buildTranscript } from "@growthmind/core";
import { rrwebEventSchema } from "@growthmind/shared";

import { beatsOf, collapseUrlTrail, summariseTranscript } from "../src/session/summarise";

describe("a recorded session becomes beats a claim can cite", () => {
  it("numbers beats from one so a citation of beat 1 is the first thing that happened", () => {
    const beats = beatsOf("0:00  opened /sign-in\n0:02  clicked button Sign in");

    expect(beats).toEqual([
      { index: 1, line: "0:00  opened /sign-in" },
      { index: 2, line: "0:02  clicked button Sign in" },
    ]);
  });

  it("produces no beats for a session with nothing in it", () => {
    expect(beatsOf("")).toEqual([]);
    expect(beatsOf("   \n  ")).toEqual([]);
  });

  it("collapses a url trail to the pages that actually changed", () => {
    expect(collapseUrlTrail(["/a", "/a", "/b", "/b", "/a"])).toEqual(["/a", "/b", "/a"]);
    expect(collapseUrlTrail([])).toEqual([]);
    expect(collapseUrlTrail(["/a"])).toEqual(["/a"]);
  });

  it("summarises an empty recording without inventing a page or a beat", () => {
    const summary = summariseTranscript(buildTranscript([]), {
      sessionId: "s-empty",
      outcome: "driver_error",
      exitReason: null,
      consoleErrors: [],
      appOrigin: "http://localhost:3000",
      urlTrail: [],
    });

    expect(summary.beats).toEqual([]);
    expect(summary.pages).toEqual([]);
    expect(summary.urlTrail).toEqual([]);
    expect(summary.counts.clicks).toBe(0);
  });

  it("withholds the exit reason unless it was asked for", () => {
    const transcript = buildTranscript([]);

    const withheld = summariseTranscript(transcript, {
      sessionId: "s-one",
      outcome: "gave_up",
      exitReason: null,
      consoleErrors: [],
      appOrigin: "http://localhost:3000",
      urlTrail: ["/sign-in"],
    });
    const given = summariseTranscript(transcript, {
      sessionId: "s-one",
      outcome: "gave_up",
      exitReason: "I could not tell what this does",
      consoleErrors: [],
      appOrigin: "http://localhost:3000",
      urlTrail: ["/sign-in"],
    });

    expect(withheld.exitReason).toBeNull();
    expect(given.exitReason).toBe("I could not tell what this does");
  });

  it("keeps the beats a real rrweb page-load produces", () => {
    const events = [
      {
        type: 4,
        timestamp: 1000,
        data: { href: "http://localhost:3000/sign-in", width: 1, height: 1 },
      },
      {
        type: 2,
        timestamp: 1001,
        data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
      },
    ].flatMap((event) => {
      const parsed = rrwebEventSchema.safeParse(event);
      return parsed.success ? [parsed.data] : [];
    });

    const summary = summariseTranscript(buildTranscript(events), {
      sessionId: "s-real",
      outcome: "gave_up",
      exitReason: null,
      consoleErrors: [],
      appOrigin: "http://localhost:3000",
      urlTrail: ["http://localhost:3000/sign-in"],
    });

    expect(summary.beats.length).toBeGreaterThan(0);
    expect(summary.beats[0]?.index).toBe(1);
  });
});
