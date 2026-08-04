import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";

import {
  DUPLICATE_ACCOUNT_TITLE,
  DuplicateAccountNotice,
} from "../../app/(auth)/duplicate-account-notice";
import { SIGN_IN_EMAIL_PARAM } from "../../lib/auth-forms";
import { ROUTES } from "../../lib/routes";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

const EMAIL = "ada@example.com";

const markup = (email: string): string =>
  renderToStaticMarkup(
    createElement(MantineProvider, null, createElement(DuplicateAccountNotice, { email })),
  );

const render = (email: string): RenderedCard => readMarkup(markup(email));

describe("the notice a returning person meets on the sign-up screen", () => {
  test("it says they have an account rather than complaining the address is taken", () => {
    const rendered = render(EMAIL);

    expect(rendered.text).toContain(DUPLICATE_ACCOUNT_TITLE);
    expect(rendered.text).not.toContain("already in use");
  });

  test("it names the address, so nobody has to guess which one it means", () => {
    expect(render(EMAIL).text).toContain(EMAIL);
  });

  test("its one control is a way in, and it carries the address with it", () => {
    const rendered = render(EMAIL);

    expect(rendered.controls).toContain("Sign in instead");

    const href = /href="([^"]+)"/.exec(markup(EMAIL))?.[1];
    expect(href).toBeDefined();
    expect(new URL(href ?? "", "http://localhost").searchParams.get(SIGN_IN_EMAIL_PARAM)).toBe(
      EMAIL,
    );
  });

  test("a malformed address still offers the way in, just without the hand-off", () => {
    const rendered = render("not-an-email");

    expect(rendered.controls).toContain("Sign in instead");
    expect(/href="([^"]+)"/.exec(markup("not-an-email"))?.[1]).toBe(ROUTES.signIn);
  });
});
