import { isNormalisedUrlPath } from "@growthmind/shared";
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
    const result = scanResidualPii("retry with sk-fixture-NeverARealKeyAAAA");

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

// D10: the credential rule's conflation neighbour is an ordinary hyphenated page path, and
// every one of these is a surface a finding can legitimately carry.
const ORDINARY_SURFACES: readonly string[] = [
  "/api-reference-getting-started",
  "/key-metrics-dashboard-page",
  "/token-refresh-flow-diagnostics",
  "/rk-8-week-onboarding-programme",
  "/settings/api-keys-and-access-tokens",
  "/docs/token-bucket-rate-limiting",
  "/blog/sk-market-entry-considerations",
  "/pk-partner-onboarding-checklist",
  "/bearer-bonds-explained-in-full",
  "/checkout",
  "/api-docs",
  "/pricing-plans-and-billing-options",
];

// Every segment here is all-digits or all-lower-case and under 16 characters, so a rule
// reading the tail's character mix alone calls a real Slack bot token a page path.
const SEGMENT_SHAPED_LIKE_WORDS: readonly string[] = [
  "xoxb-1234567890-abcdefghij",
  "token-abcdefghij-klmnopqr",
  "api-secretvaluehere-more",
];

// Shaped like each vendor's key but deliberately short of its real length, so GitHub's own
// push protection does not reject the branch that teaches our scanner what a key looks like.
const GENUINE_CREDENTIALS: readonly string[] = [
  "sk-fixture-NeverARealKeyAAAA",
  "sk-plantedbyatestneverarealkey",
  "ghp_FixtureNotARealTokenAa1",
  "xoxb-fixture-NotARealSlackTokenAa1",
  "API_KEY_AbC123DeF456GhI789Jkl",
  "token_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c",
  "pk_live_51H2j3K4l5M6n7O8p9Q0r",
  ...SEGMENT_SHAPED_LIKE_WORDS,
];

const CREDENTIALS_IN_PATH_POSITION: readonly string[] = [
  "/sk-fixture-NeverARealKeyAAAA",
  "/sk-fixture-neverarealkeyaaaa",
  "/callback/pk_live_51H2j3K4l5M6n7O8p9Q0r",
];

describe("scanResidualPii — the credential rule and its conflation neighbour", () => {
  test("every ordinary page path is a normalised surface and classifies clean", () => {
    const dirty: string[] = [];

    for (const surface of ORDINARY_SURFACES) {
      expect({ surface, normalised: isNormalisedUrlPath(surface) }).toEqual({
        surface,
        normalised: true,
      });

      const result = scanResidualPii(surface);
      if (!result.clean) {
        dirty.push(`${surface}: ${result.findings.map((finding) => finding.kind).join(",")}`);
      }
    }

    expect(dirty).toEqual([]);
  });

  test("the same paths stay clean inside a sentence that names them, which is the only way a finding carries one", () => {
    const dirty: string[] = [];

    for (const surface of ORDINARY_SURFACES) {
      const sentence = `Something people are doing on ${surface} is not working.`;
      if (!isCleanForDelivery(sentence)) dirty.push(sentence);
    }

    expect(dirty).toEqual([]);
  });

  test("a genuine key still classifies dirty, in a sentence and on its own", () => {
    const missed: string[] = [];

    for (const secret of GENUINE_CREDENTIALS) {
      const alone = scanResidualPii(secret);
      const embedded = scanResidualPii(`One session carried the value ${secret} through the form.`);

      const caught =
        alone.findings.some((finding) => finding.kind === "credential") &&
        embedded.findings.some((finding) => finding.kind === "credential");

      if (!caught) missed.push(secret);
    }

    expect(missed).toEqual([]);
  });

  test("a credential in a path position is still caught when a segment is key-shaped", () => {
    const missed: string[] = [];

    for (const secret of CREDENTIALS_IN_PATH_POSITION) {
      const result = scanResidualPii(`the session ended on ${secret} without converting`);
      if (!result.findings.some((finding) => finding.kind === "credential")) missed.push(secret);
    }

    expect(missed).toEqual([]);
  });

  test("a JSON web token is still caught by its own rule", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
    const result = scanResidualPii(`the header carried ${jwt} through`);

    expect(result.findings.map((finding) => finding.kind)).toContain("credential");
  });
});

describe("scanResidualPii — position decides which credential rule applies, and prose gets the strict one", () => {
  test("the tail-shape relaxation is granted only after a `/`; the same string in prose is dirty", () => {
    const missed: string[] = [];

    for (const secret of SEGMENT_SHAPED_LIKE_WORDS) {
      const bare = isCleanForDelivery(secret);
      const inSentence = isCleanForDelivery(`the form carried ${secret} into the payload`);
      const afterWord = isCleanForDelivery(`value=${secret}`);

      if (bare || inSentence || afterWord) missed.push(secret);
    }

    expect(missed).toEqual([]);
  });

  test("the relaxation is what makes the same shape clean inside a path, and it is the only difference", () => {
    for (const secret of SEGMENT_SHAPED_LIKE_WORDS) {
      expect({
        secret,
        prose: isCleanForDelivery(secret),
        path: isCleanForDelivery(`/${secret}`),
      }).toEqual({ secret, prose: false, path: true });
    }
  });

  test("a path position relaxes the tail's character mix and nothing else — prefix and length still hold", () => {
    expect(isCleanForDelivery("/api-docs")).toBe(true);
    expect(isCleanForDelivery("/reference-getting-started-guide")).toBe(true);
    expect(isCleanForDelivery("/sk-fixture-NeverARealKeyAAAA")).toBe(false);
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
