// The pure DTO/story-resolution functions from the ADD's D-6/D-7 contract
// (.ai/adds/o-039-account-view.md §6-7). Nothing under "@/lib/companies/dto" exists yet —
// this file is Wave 0's red baseline for it.
import type { FindingText, SessionRecord } from "@growthmind/db";
import { scannedTextFor } from "@growthmind/db/testing";
import { describe, expect, test } from "bun:test";

import {
  resolveCompanySessionStory,
  toCompanyGroupDto,
  toCompanySessionDto,
} from "@/lib/companies/dto";

// A literal distinctive enough that finding it anywhere in a JSON.stringify'd DTO can only
// mean the DTO leaked the raw session row instead of naming its fields (D-10 Layer 1).
const LEAK_MARKER = "should-never-leak-0001";

function sessionFixture(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const startedAt = new Date("2026-08-05T09:00:00.000Z");
  return {
    id: "dto-session-1",
    organizationId: "dto-org-1",
    projectId: "dto-project-1",
    connectionId: "dto-connection-1",
    sessionKey: "ph:dto-session-1",
    identityKey: LEAK_MARKER,
    identityEmailDomain: "acme.com",
    identityResolution: "resolved",
    userAgent: null,
    entryUrlPath: "/pricing",
    startedAt,
    lastEventAt: startedAt,
    origin: "real",
    exclusionReason: "none",
    internalDomainAtStamp: null,
    exclusionRuleSetVersion: 1,
    groupingVersion: 1,
    createdAt: startedAt,
    updatedAt: startedAt,
    ...overrides,
  } as SessionRecord;
}

// Not annotated as `FindingText` — the point of this fixture is to read `.headline` and
// `.context` directly in the "resolved" assertion below, which the union type alone would
// not narrow without a runtime check on `held`.
const CLEAN_TEXT = {
  held: false as const,
  ...scannedTextFor("Someone hit a payment error at checkout", [
    "They opened /checkout, submitted payment, and saw an error.",
  ]),
};

const HELD_TEXT: FindingText = { held: true, why: "unreadable" };

describe("resolveCompanySessionStory", () => {
  test("returns no_recording when recordingId is null, regardless of any summary text passed alongside it", () => {
    expect(resolveCompanySessionStory(null, CLEAN_TEXT)).toEqual({ kind: "no_recording" });
  });

  test("returns pending when recordingId resolves but text is null", () => {
    expect(resolveCompanySessionStory("rec1", null)).toEqual({ kind: "pending" });
  });

  test("returns held when text.held is true", () => {
    expect(resolveCompanySessionStory("rec1", HELD_TEXT)).toEqual({ kind: "held" });
  });

  test("returns resolved with headline and context when text.held is false", () => {
    expect(resolveCompanySessionStory("rec1", CLEAN_TEXT)).toEqual({
      kind: "resolved",
      headline: CLEAN_TEXT.headline,
      context: CLEAN_TEXT.context,
    });
  });
});

describe("toCompanySessionDto", () => {
  test("never carries identityKey even though the source SessionRecord fixture has one", () => {
    const session = sessionFixture({ identityKey: LEAK_MARKER });

    const dto = toCompanySessionDto(session, null, { kind: "no_recording" });

    expect(JSON.stringify(dto)).not.toContain(LEAK_MARKER);
  });

  test("serialises startedAt as an ISO string and passes entryUrlPath through verbatim", () => {
    const session = sessionFixture({
      startedAt: new Date("2026-08-05T11:30:00.000Z"),
      entryUrlPath: "/checkout/step-2",
    });

    const dto = toCompanySessionDto(session, "rec1", { kind: "pending" });

    expect(dto.startedAt).toBe("2026-08-05T11:30:00.000Z");
    expect(dto.entryUrlPath).toBe("/checkout/step-2");
  });
});

describe("toCompanyGroupDto", () => {
  test("serialises mostRecentSessionAt as an ISO string", () => {
    const group = {
      domain: "acme.com",
      sessionCount: 3,
      mostRecentSessionAt: new Date("2026-08-05T12:00:00.000Z"),
    };

    const dto = toCompanyGroupDto(group);

    expect(dto.mostRecentSessionAt).toBe("2026-08-05T12:00:00.000Z");
  });
});
