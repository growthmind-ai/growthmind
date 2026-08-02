import { describe, expect, test } from "bun:test";

import {
  DEFAULT_POSTHOG_HOST,
  POSTHOG_PROXY_PATH,
  resolvePostHogHosts,
} from "../lib/posthog-hosts";

describe("resolvePostHogHosts", () => {
  test("with nothing set, keeps the shipped EU-cloud trio", () => {
    expect(resolvePostHogHosts({})).toEqual({
      apiHost: "https://eu.i.posthog.com",
      assetsHost: "https://eu-assets.i.posthog.com",
      uiHost: "https://eu.posthog.com",
    });
    expect(DEFAULT_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });

  test("splits a Cloud US api host into Cloud's asset and UI origins", () => {
    expect(resolvePostHogHosts({ host: "https://us.i.posthog.com" })).toEqual({
      apiHost: "https://us.i.posthog.com",
      assetsHost: "https://us-assets.i.posthog.com",
      uiHost: "https://us.posthog.com",
    });
  });

  test("collapses all three origins onto a self-hosted PostHog", () => {
    const hosts = resolvePostHogHosts({ host: "https://posthog.acme.com" });

    expect(hosts).toEqual({
      apiHost: "https://posthog.acme.com",
      assetsHost: "https://posthog.acme.com",
      uiHost: "https://posthog.acme.com",
    });
    expect(JSON.stringify(hosts)).not.toContain("posthog.com/");
    expect(JSON.stringify(hosts)).not.toContain("i.posthog.com");
  });

  test("a self-hosted origin on http and a non-default port survives intact", () => {
    expect(resolvePostHogHosts({ host: "http://posthog.internal:8000" })).toEqual({
      apiHost: "http://posthog.internal:8000",
      assetsHost: "http://posthog.internal:8000",
      uiHost: "http://posthog.internal:8000",
    });
  });

  test("explicit asset and UI overrides beat both the derivation and the default", () => {
    expect(
      resolvePostHogHosts({
        host: "https://eu.i.posthog.com",
        assetsHost: "https://cdn.acme.com",
        uiHost: "https://insights.acme.com",
      }),
    ).toEqual({
      apiHost: "https://eu.i.posthog.com",
      assetsHost: "https://cdn.acme.com",
      uiHost: "https://insights.acme.com",
    });
  });

  test("an override applies even when the api host is left at its default", () => {
    const hosts = resolvePostHogHosts({ assetsHost: "https://cdn.acme.com" });

    expect(hosts.apiHost).toBe(DEFAULT_POSTHOG_HOST);
    expect(hosts.assetsHost).toBe("https://cdn.acme.com");
    expect(hosts.uiHost).toBe("https://eu.posthog.com");
  });

  test("trailing slashes are stripped, so no destination doubles them", () => {
    const hosts = resolvePostHogHosts({ host: "https://posthog.acme.com///" });

    expect(hosts.apiHost).toBe("https://posthog.acme.com");
    expect(`${hosts.assetsHost}/static/x.js`).toBe("https://posthog.acme.com/static/x.js");
  });

  test("blank and whitespace-only values are absent, not empty hosts", () => {
    expect(resolvePostHogHosts({ host: "", assetsHost: "   ", uiHost: "" })).toEqual({
      apiHost: "https://eu.i.posthog.com",
      assetsHost: "https://eu-assets.i.posthog.com",
      uiHost: "https://eu.posthog.com",
    });
    expect(resolvePostHogHosts({ host: undefined }).apiHost).toBe(DEFAULT_POSTHOG_HOST);
  });

  test("a host that merely resembles Cloud is treated as self-hosted", () => {
    for (const host of [
      "https://eu.posthog.com",
      "https://eu.i.posthog.com.acme.dev",
      "https://ap.i.posthog.com",
    ]) {
      const hosts = resolvePostHogHosts({ host });
      expect(hosts.assetsHost).toBe(host);
      expect(hosts.uiHost).toBe(host);
    }
  });
});

describe("POSTHOG_PROXY_PATH", () => {
  test("is a rooted path both the rewrite source and the browser SDK share", () => {
    expect(POSTHOG_PROXY_PATH).toBe("/ingest");
    expect(POSTHOG_PROXY_PATH.startsWith("/")).toBe(true);
    expect(POSTHOG_PROXY_PATH.endsWith("/")).toBe(false);
  });
});
