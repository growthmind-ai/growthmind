import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, MantineProvider } from "@mantine/core";

import { LastUsedBadge } from "../../components/ui/LastUsedBadge";
import { readMarkup, type RenderedCard } from "../first-run/helpers/rendered-markup";

// The sign-in form's own button reaches the marker through this component and cannot be
// rendered here — it calls useRouter, which has no app router outside Next. The prop that
// carries the method into it is required and typed, so the wire itself is a compile error
// to sever; what needs a test is what this renders once it arrives.
function markup(lastUsed: boolean): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <LastUsedBadge badgeId="marker" lastUsed={lastUsed}>
        <Button type="submit">Sign in</Button>
      </LastUsedBadge>
    </MantineProvider>,
  );
}

const render = (lastUsed: boolean): RenderedCard => readMarkup(markup(lastUsed));

describe("the last-used marker over a control", () => {
  test("the marked control carries the words a person reads", () => {
    expect(render(true).text).toContain("Last used");
  });

  test("an unmarked control says nothing about last time", () => {
    expect(render(false).text).not.toContain("Last used");
  });

  test("the control survives either way, and keeps its own name", () => {
    expect(render(true).controls).toEqual(["Sign in"]);
    expect(render(false).controls).toEqual(["Sign in"]);
  });

  test("the marker cannot swallow the click meant for the control beneath it", () => {
    expect(markup(true)).toContain("pointer-events:none");
  });
});
