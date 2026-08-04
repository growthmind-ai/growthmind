import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import { SocialButtons } from "../../app/(auth)/social-buttons";
import type { LastLoginMethod } from "../../lib/last-login-method";
import type { SocialProviderId } from "../../lib/social-auth";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

const SOCIAL: readonly SocialProviderId[] = ["google", "github"];

// `readMarkup` drops the provider's own <style> tags, so these rows assert what a person
// sees rather than what React emitted.
function render(
  providers: readonly SocialProviderId[],
  lastUsed: LastLoginMethod | null = null,
): RenderedCard {
  return readMarkup(
    renderToStaticMarkup(
      createElement(MantineProvider, null, createElement(SocialButtons, { providers, lastUsed })),
    ),
  );
}

const markers = (card: RenderedCard): number => card.text.split("Last used").length - 1;

// Driven from BOTH ends: the producer resolving the list is tested in social-auth.test.ts,
// and these rows prove the consumer actually branches on it. A provider registered on the
// server with no control on the screen is a feature nobody can reach.
describe("the social sign-in wire — providers, driven into the rendered control", () => {
  test("no configured provider puts nothing on the screen, not an empty divider", () => {
    const rendered = render([]);

    expect(rendered.controls).toEqual([]);
    expect(rendered.text).toBe("");
  });

  test("a configured provider renders its own named control", () => {
    const rendered = render(["google"]);

    expect(rendered.controls).toContain("Continue with Google");
    expect(rendered.controls).not.toContain("Continue with GitHub");
  });

  test("both configured providers each get a control", () => {
    const rendered = render(["google", "github"]);

    expect(rendered.controls).toContain("Continue with Google");
    expect(rendered.controls).toContain("Continue with GitHub");
  });

  test("the divider separating social from email appears only when a control sits above it", () => {
    expect(render([]).text).not.toContain("or");
    expect(render(["github"]).text).toContain("or");
  });

  test("the three provider lists do not put the same thing on the screen", () => {
    const rendered = [render([]), render(["google"]), render(["google", "github"])];

    expect(new Set(rendered.map((card) => card.text)).size).toBe(3);
  });

  test("no credential is rendered into the markup the browser receives", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(SocialButtons, { providers: SOCIAL, lastUsed: null }),
      ),
    );

    for (const forbidden of ["CLIENT_SECRET", "client_secret", "GOOGLE_CLIENT_ID"]) {
      expect(markup).not.toContain(forbidden);
    }
  });
});

describe("the last-used marker on the social controls", () => {
  test("a returning visitor sees it on the one provider they used, and nowhere else", () => {
    const rendered = render(SOCIAL, "github");

    expect(markers(rendered)).toBe(1);
    expect(rendered.text).toContain("Continue with GitHub Last used");
  });

  test("a first-time visitor is not told anything was used last", () => {
    expect(markers(render(SOCIAL, null))).toBe(0);
  });

  test("email as the last method marks no social control", () => {
    expect(markers(render(SOCIAL, "email"))).toBe(0);
  });

  test("the marker stays out of the button's own name", () => {
    const rendered = render(SOCIAL, "google");

    expect(rendered.controls).toContain("Continue with Google");
    expect(rendered.controls).not.toContain("Continue with Google Last used");
  });

  test("the marked button points a screen reader at the marker it sits under", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(SocialButtons, { providers: SOCIAL, lastUsed: "google" }),
      ),
    );
    const described = /aria-describedby="([^"]+)"/.exec(markup)?.[1];

    expect(described).toBeDefined();
    expect(markup).toContain(`id="${described ?? ""}"`);
    expect(markup.match(/aria-describedby=/g)).toHaveLength(1);
  });
});
