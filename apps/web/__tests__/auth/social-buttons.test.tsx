import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import { SocialButtons } from "../../app/(auth)/social-buttons";
import type { SocialProviderId } from "../../lib/social-auth";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

const SOCIAL: readonly SocialProviderId[] = ["google", "github"];

// `readMarkup` drops the provider's own <style> tags, so these rows assert what a person
// sees rather than what React emitted.
function render(providers: readonly SocialProviderId[]): RenderedCard {
  return readMarkup(
    renderToStaticMarkup(
      createElement(MantineProvider, null, createElement(SocialButtons, { providers })),
    ),
  );
}

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
      createElement(MantineProvider, null, createElement(SocialButtons, { providers: SOCIAL })),
    );

    for (const forbidden of ["CLIENT_SECRET", "client_secret", "GOOGLE_CLIENT_ID"]) {
      expect(markup).not.toContain(forbidden);
    }
  });
});
