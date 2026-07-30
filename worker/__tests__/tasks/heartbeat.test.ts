import { expect, test } from "bun:test";

import { heartbeatMessage } from "../../src/tasks/heartbeat";

test("heartbeat message carries the ISO timestamp", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  expect(heartbeatMessage(now)).toBe("worker alive at 2026-07-29T12:00:00.000Z");
});
