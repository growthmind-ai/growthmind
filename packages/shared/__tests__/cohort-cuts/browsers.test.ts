import { describe, expect, test } from "bun:test";

import { classifyBrowserFamily } from "../../src/cohort-cuts/browsers";

const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHROME_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHROME_ON_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";

const EDGE_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51";

const EDGE_ON_ANDROID =
  "Mozilla/5.0 (Linux; Android 10; HD1913) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.2535.51";

const EDGE_ON_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.2535.60 Mobile/15E148 Safari/605.1.15";

const SAFARI_ON_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const FIREFOX_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

const FIREFOX_ON_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15";

const OPERA_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0";

const SAMSUNG_INTERNET_ON_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";

const KONQUEROR = "Mozilla/5.0 (compatible; Konqueror/4.5; FreeBSD) KHTML/4.5.4 (like Gecko)";

const LYNX = "Lynx/2.8.9rel.1 libwww-FM/2.14 SSL-MM/1.4.1 OpenSSL/1.1.1k";

const TRUNCATED_BEFORE_CHROME_TOKEN = CHROME_ON_WINDOWS.slice(
  0,
  CHROME_ON_WINDOWS.indexOf("Chrome/"),
);

const TRUNCATED_AFTER_CHROME_TOKEN = CHROME_ON_WINDOWS.slice(
  0,
  CHROME_ON_WINDOWS.indexOf("Safari/"),
);

const CONTROL_CHARACTERS = String.fromCharCode(0, 1, 9, 27, 31, 127);

const GARBAGE_BYTES = String.fromCharCode(0xff, 0xfe, 0xfd, 0x80, 0xfffd);

describe("classifyBrowserFamily - ordered token gates over an enumerated list", () => {
  test("an Edge UA classifies as edge even though it carries the Chrome and Safari tokens", () => {
    for (const userAgent of [EDGE_ON_WINDOWS, EDGE_ON_ANDROID, EDGE_ON_IOS]) {
      expect(classifyBrowserFamily(userAgent)).toBe("edge");
      expect(classifyBrowserFamily(userAgent)).not.toBe("chrome");
      expect(classifyBrowserFamily(userAgent)).not.toBe("safari");
    }
  });

  test("a Chrome UA classifies as chrome even though it carries the Safari token", () => {
    expect(classifyBrowserFamily(CHROME_ON_WINDOWS)).toBe("chrome");
    expect(classifyBrowserFamily(CHROME_ON_MAC)).toBe("chrome");
    expect(classifyBrowserFamily(CHROME_ON_IOS)).toBe("chrome");

    expect(classifyBrowserFamily(CHROME_ON_WINDOWS)).not.toBe("safari");
    expect(classifyBrowserFamily(CHROME_ON_IOS)).not.toBe("safari");
  });

  test("a Safari UA carrying no Chrome, CriOS or Edg token classifies as safari", () => {
    expect(classifyBrowserFamily(SAFARI_ON_MAC)).toBe("safari");
    expect(classifyBrowserFamily(SAFARI_ON_IPHONE)).toBe("safari");
  });

  test("Firefox on desktop and Firefox on iOS both classify as firefox", () => {
    expect(classifyBrowserFamily(FIREFOX_ON_WINDOWS)).toBe("firefox");
    expect(classifyBrowserFamily(FIREFOX_ON_IOS)).toBe("firefox");
  });

  test("an enumerated long-tail browser classifies as other", () => {
    expect(classifyBrowserFamily(OPERA_ON_WINDOWS)).toBe("other");
    expect(classifyBrowserFamily(SAMSUNG_INTERNET_ON_ANDROID)).toBe("other");
  });

  test("an absent, empty or whitespace user agent classifies as unknown", () => {
    expect(classifyBrowserFamily(null)).toBe("unknown");
    expect(classifyBrowserFamily("")).toBe("unknown");
    expect(classifyBrowserFamily("   ")).toBe("unknown");
  });

  test("a UA truncated before its family token classifies as unknown, never as other", () => {
    expect(TRUNCATED_BEFORE_CHROME_TOKEN).not.toContain("Chrome/");
    expect(classifyBrowserFamily(TRUNCATED_BEFORE_CHROME_TOKEN)).toBe("unknown");
    expect(classifyBrowserFamily(TRUNCATED_BEFORE_CHROME_TOKEN)).not.toBe("other");
    expect(classifyBrowserFamily(TRUNCATED_BEFORE_CHROME_TOKEN)).not.toBe("chrome");
  });

  test("a UA truncated after its family token still classifies as that family", () => {
    expect(TRUNCATED_AFTER_CHROME_TOKEN).toContain("Chrome/");
    expect(TRUNCATED_AFTER_CHROME_TOKEN).not.toContain("Safari/");
    expect(classifyBrowserFamily(TRUNCATED_AFTER_CHROME_TOKEN)).toBe("chrome");
  });

  test("garbage, control characters, a JSON blob and a very long string classify as unknown without throwing", () => {
    for (const userAgent of [
      CONTROL_CHARACTERS,
      GARBAGE_BYTES,
      '{"session":{"id":"abc","started_at":"2026-08-06T00:00:00.000Z"}}',
      "x".repeat(100_000),
      "<>?!@#$%^&*()_+=[]{}|;:,.",
    ]) {
      expect(() => classifyBrowserFamily(userAgent)).not.toThrow();
      expect(classifyBrowserFamily(userAgent)).toBe("unknown");
    }
  });

  test("a real but unlisted browser classifies as unknown rather than a guessed family", () => {
    expect(classifyBrowserFamily(KONQUEROR)).toBe("unknown");
    expect(classifyBrowserFamily(LYNX)).toBe("unknown");
  });
});
