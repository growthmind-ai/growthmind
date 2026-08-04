import { describe, expect, it, test } from "bun:test";

import { isCleanForDelivery, scanResidualPii } from "../../src/delivery/residual-pii";

describe("scanResidualPii — detects the classes it claims to detect", () => {
  it("flags an email address", () => {
    const result = scanResidualPii("Checkout failed for jane.doe@acme.example twice.");

    expect(result.clean).toBe(false);
    expect(result.findings.map((f) => f.kind)).toContain("email_address");
  });

  it("flags a payment card number", () => {
    const result = scanResidualPii("card 4111 1111 1111 1111 was declined");

    expect(result.findings.map((f) => f.kind)).toContain("payment_card");
  });

  it("flags an IP address", () => {
    const result = scanResidualPii("request came from 203.0.113.42");

    expect(result.findings.map((f) => f.kind)).toContain("ip_address");
  });

  it("flags a phone number", () => {
    const result = scanResidualPii("they called +44 7700 900123 to complain");

    expect(result.findings.map((f) => f.kind)).toContain("phone_number");
  });

  it("flags a credential-shaped token", () => {
    const result = scanResidualPii("retry with sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH");

    expect(result.findings.map((f) => f.kind)).toContain("credential");
  });
});

describe("scanResidualPii — NEVER echoes the matched text", () => {
  it("reports kind and offset but no fragment of the personal data", () => {
    const email = "jane.doe@acme.example";
    const result = scanResidualPii(`Checkout failed for ${email} twice.`);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(email);
    expect(serialised).not.toContain("jane.doe");
    expect(serialised).not.toContain("acme.example");

    expect(result.findings[0]?.at).toBeGreaterThan(0);
  });

  it("does not echo a card number in its report", () => {
    const result = scanResidualPii("card 4111 1111 1111 1111 declined");

    expect(JSON.stringify(result)).not.toContain("4111");
  });
});

describe("scanResidualPii — fail direction is CLOSED (block on doubt)", () => {
  it("blocks text it cannot make a clean judgement about rather than passing it", () => {
    expect(isCleanForDelivery("account 9876543210987654 was charged")).toBe(false);
  });

  it("passes ordinary finding prose that contains no personal data", () => {
    const prose =
      "3 of 28 sessions dropped off at the payment step. That is the biggest single drop in this funnel.";

    expect(isCleanForDelivery(prose)).toBe(true);
    expect(scanResidualPii(prose).findings).toHaveLength(0);
  });

  it("passes a count with denominators and a URL path, which findings always carry", () => {
    expect(isCleanForDelivery("12 of 240 sessions failed on /checkout/payment.")).toBe(true);
  });
});

describe("scanResidualPii — the miss it cannot cover, stated out loud", () => {
  it("does NOT detect a bare personal name — upstream masking is the real control", () => {
    expect(isCleanForDelivery("Jane Doe abandoned the checkout")).toBe(true);
  });
});

describe("scanResidualPii — data shape", () => {
  it("treats empty string as clean", () => {
    expect(scanResidualPii("").clean).toBe(true);
    expect(scanResidualPii("").findings).toHaveLength(0);
  });

  it("reports every distinct occurrence when text carries several", () => {
    const result = scanResidualPii("a@b.example and c@d.example both bounced from 203.0.113.42");

    expect(result.findings.length).toBeGreaterThanOrEqual(3);
    expect(result.findings.map((f) => f.kind)).toContain("ip_address");
  });

  it("returns findings ordered by position so the first problem is first", () => {
    const result = scanResidualPii("clean words then a@b.example then 203.0.113.42");
    const offsets = result.findings.map((f) => f.at);

    expect(offsets.toSorted((x, y) => x - y)).toEqual(offsets);
  });
});

describe("scanResidualPii — the false positive it accepts, documented rather than tuned", () => {
  test("a 12-plus digit session id that is not a payment card still trips the bare digit-run fallback (documented near-miss)", () => {
    const twelveDigitId = "019482736150";
    const fourteenDigitId = "01948273615042";

    expect(twelveDigitId).toHaveLength(12);
    expect(fourteenDigitId).toHaveLength(14);

    for (const sessionId of [twelveDigitId, fourteenDigitId]) {
      const result = scanResidualPii(`session ${sessionId} ended on /checkout/payment.`);

      expect(result.clean).toBe(false);
      expect(result.findings.map((f) => f.kind)).toEqual(["payment_card"]);
    }
  });
});
