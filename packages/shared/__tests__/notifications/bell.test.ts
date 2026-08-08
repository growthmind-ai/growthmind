import { describe, expect, test } from "bun:test";

import {
  NOTIFICATION_BADGE_COUNT_CAP,
  NOTIFICATION_LIST_LIMIT,
  NOTIFICATION_WINDOW_DAYS,
} from "../../src/notifications/bell";

describe("the badge cap can never exceed the list limit", () => {
  test("cap <= limit, so the badge's counted rows are always a subset of what the popover shows", () => {
    // §9 hazard 3: this inequality is why the C-5 limit divergence is unreachable — the
    // badge's newest ten are always inside the list's newest twenty.
    expect(NOTIFICATION_BADGE_COUNT_CAP).toBeLessThanOrEqual(NOTIFICATION_LIST_LIMIT);
  });

  test("the three constants are 10 / 20 / 30, and one home holds them", () => {
    expect(NOTIFICATION_BADGE_COUNT_CAP).toBe(10);
    expect(NOTIFICATION_LIST_LIMIT).toBe(20);
    expect(NOTIFICATION_WINDOW_DAYS).toBe(30);
  });
});
