import { describe, expect, test } from "bun:test";

import { classifyDeviceType } from "../../src/cohort-cuts/devices";

const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const KINDLE_FIRE_SILK =
  "Mozilla/5.0 (Linux; U; en-us; KFTHWI Build/JDQ39) AppleWebKit/537.36 (KHTML, like Gecko) Silk/3.68 like Chrome/39.0.2171.93 Safari/537.36";

const FIRE_TABLET_SILK_ON_ANDROID =
  "Mozilla/5.0 (Linux; U; Android 9; en-us; KFONWI Build/PS7315) AppleWebKit/537.36 (KHTML, like Gecko) Silk/106.4.1 like Chrome/106.0.5249.126 Safari/537.36";

const ANDROID_TABLET_WITHOUT_MOBILE_TOKEN =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const ANDROID_PHONE_CHROME =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const ANDROID_PHONE_FIREFOX =
  "Mozilla/5.0 (Android 13; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const LINUX_X11_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CHROMEOS_CHROME =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CONTROL_CHARACTERS = String.fromCharCode(0, 1, 9, 27, 31, 127);

const GARBAGE_BYTES = String.fromCharCode(0xff, 0xfe, 0xfd, 0x80, 0xfffd);

describe("classifyDeviceType - tablet before mobile before desktop", () => {
  test("an iPad, a Silk tablet and an Android UA without the Mobile token classify as tablet", () => {
    for (const userAgent of [
      IPAD_SAFARI,
      KINDLE_FIRE_SILK,
      FIRE_TABLET_SILK_ON_ANDROID,
      ANDROID_TABLET_WITHOUT_MOBILE_TOKEN,
    ]) {
      expect(classifyDeviceType(userAgent)).toBe("tablet");
    }

    expect(IPAD_SAFARI).toContain("Mobile/");
    expect(classifyDeviceType(IPAD_SAFARI)).not.toBe("mobile");

    expect(ANDROID_TABLET_WITHOUT_MOBILE_TOKEN).not.toContain("Mobile");
  });

  test("an iPhone and an Android UA carrying the Mobile token classify as mobile", () => {
    expect(classifyDeviceType(IPHONE_SAFARI)).toBe("mobile");
    expect(classifyDeviceType(ANDROID_PHONE_CHROME)).toBe("mobile");
    expect(classifyDeviceType(ANDROID_PHONE_FIREFOX)).toBe("mobile");
  });

  test("an Android UA classifies as mobile even though it carries the Linux token", () => {
    expect(ANDROID_PHONE_CHROME).toContain("Linux");
    expect(classifyDeviceType(ANDROID_PHONE_CHROME)).toBe("mobile");
    expect(classifyDeviceType(ANDROID_PHONE_CHROME)).not.toBe("desktop");
  });

  test("Windows NT, Macintosh, X11 and CrOS classify as desktop", () => {
    for (const userAgent of [WINDOWS_CHROME, MAC_SAFARI, LINUX_X11_CHROME, CHROMEOS_CHROME]) {
      expect(classifyDeviceType(userAgent)).toBe("desktop");
    }
  });

  test("an absent, empty, whitespace or unparseable user agent classifies as unknown without throwing", () => {
    for (const userAgent of [
      null,
      "",
      "   ",
      CONTROL_CHARACTERS,
      GARBAGE_BYTES,
      '{"session":{"id":"abc"}}',
      "x".repeat(100_000),
    ]) {
      expect(() => classifyDeviceType(userAgent)).not.toThrow();
      expect(classifyDeviceType(userAgent)).toBe("unknown");
    }
  });
});
