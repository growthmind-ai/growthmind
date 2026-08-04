import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { RETURNING_NOTICE, SignInForm } from "../../app/(auth)/sign-in/sign-in-form";
import { readMarkup } from "../first-run/helpers/rendered-markup";

const EMAIL = "ada@example.com";

// The form calls useRouter for its success path. Mounting the context it really asks for
// keeps the render real — a stubbed module would leak into every other suite in the run.
const ROUTER = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
} as unknown as React.ContextType<typeof AppRouterContext>;

const markup = (initialEmail: string): string =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(
        MantineProvider,
        null,
        createElement(SignInForm, { lastUsed: null, initialEmail }),
      ),
    ),
  );

const emailValue = (html: string): string | undefined =>
  /<input[^>]*type="email"[^>]*value="([^"]*)"/.exec(html)?.[1];

describe("the sign-in screen receiving a handed-off address", () => {
  test("the address arrives already in the field, so it is not typed twice", () => {
    expect(emailValue(markup(EMAIL))).toBe(EMAIL);
  });

  test("arriving with no address leaves an empty field and no welcome-back line", () => {
    const html = markup("");

    expect(emailValue(html)).toBe("");
    expect(readMarkup(html).text).not.toContain(RETURNING_NOTICE);
  });

  test("the line explains why the address is sitting there", () => {
    expect(readMarkup(markup(EMAIL)).text).toContain(RETURNING_NOTICE);
  });

  test("the handed-off address is never rendered into a password field", () => {
    expect(/<input[^>]*type="password"[^>]*value="[^"]+"/.test(markup(EMAIL))).toBe(false);
  });
});
