import { describe, expect, test } from "bun:test";

import {
  disallowedPaths,
  fetchSite,
  isAllowed,
  originOf,
  SITE_TEXT_LIMIT,
  textOf,
} from "../../src/site/fetch";

describe("originOf", () => {
  test("accepts a bare domain and a pasted url alike", () => {
    expect(originOf("growthmind.ai")).toBe("https://growthmind.ai");
    expect(originOf("https://growthmind.ai")).toBe("https://growthmind.ai");
    expect(originOf("https://growthmind.ai/pricing")).toBe("https://growthmind.ai");
    expect(originOf("  GrowthMind.AI  ")).toBe("https://growthmind.ai");
  });

  test("refuses anything that is not a domain", () => {
    for (const input of ["", "   ", "localhost", "not a domain", "javascript:alert(1)", "/path"]) {
      expect(originOf(input)).toBeNull();
    }
  });

  test("refuses a name that resolves inward, and every ip literal", () => {
    // A person names this and the server fetches it. The letters-only suffix already
    // refuses `127.0.0.1` and `169.254.169.254`; these are the names that do it by word.
    for (const input of [
      "127.0.0.1",
      "169.254.169.254",
      "10.0.0.5",
      "printer.local",
      "db.internal",
      "host.localdomain",
      "thing.lan",
      "box.corp",
    ]) {
      expect(originOf(input)).toBeNull();
    }
  });

  test("always speaks https, whatever was pasted", () => {
    expect(originOf("http://growthmind.ai")).toBe("https://growthmind.ai");
  });
});

describe("disallowedPaths", () => {
  test("reads only the rules addressed to everyone", () => {
    const robots = [
      "User-agent: BadBot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /admin",
      "Disallow: /internal",
      "Allow: /",
    ].join("\n");

    expect(disallowedPaths(robots)).toEqual(["/admin", "/internal"]);
  });

  test("an empty or absent robots file disallows nothing", () => {
    expect(disallowedPaths("")).toEqual([]);
  });

  test("ignores a disallow that names no path", () => {
    expect(disallowedPaths("User-agent: *\nDisallow:")).toEqual([]);
  });
});

describe("isAllowed", () => {
  test("a bare slash closes the whole site", () => {
    expect(isAllowed("/pricing", ["/"])).toBe(false);
  });

  test("a prefix closes what sits under it and nothing else", () => {
    expect(isAllowed("/admin/users", ["/admin"])).toBe(false);
    expect(isAllowed("/pricing", ["/admin"])).toBe(true);
  });
});

describe("textOf", () => {
  test("drops script and style bodies rather than reading them as prose", () => {
    const html = "<html><script>alert('x')</script><style>.a{}</style><p>For agencies</p></html>";

    expect(textOf(html)).toBe("For agencies");
  });

  test("unescapes the entities a reader would see", () => {
    expect(textOf("<p>Tools &amp; teams</p>")).toBe("Tools & teams");
  });

  test("caps what one page can contribute", () => {
    expect(textOf(`<p>${"a".repeat(SITE_TEXT_LIMIT * 2)}</p>`).length).toBe(SITE_TEXT_LIMIT);
  });
});

function respond(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

describe("fetchSite", () => {
  test("refuses a domain it cannot read as a domain, without calling out", async () => {
    let called = 0;
    const result = await fetchSite(
      {
        fetch: () => {
          called += 1;
          return Promise.resolve(respond(""));
        },
      },
      "not a domain",
    );

    expect(result).toEqual({ ok: false, code: "domain_unreadable" });
    expect(called).toBe(0);
  });

  test("does not fetch a page the site's robots file closes", async () => {
    const asked: string[] = [];

    await fetchSite(
      {
        fetch: (input: string) => {
          const url = String(input);
          asked.push(url);
          return Promise.resolve(
            url.endsWith("/robots.txt")
              ? respond("User-agent: *\nDisallow: /pricing")
              : respond("<p>hello</p>"),
          );
        },
      },
      "example.com",
    );

    expect(asked.some((url) => url.endsWith("/pricing"))).toBe(false);
    expect(asked.some((url) => url.endsWith("/about"))).toBe(true);
  });

  test("says so when robots closes the whole site", async () => {
    const result = await fetchSite(
      { fetch: () => Promise.resolve(respond("User-agent: *\nDisallow: /")) },
      "example.com",
    );

    expect(result).toEqual({ ok: false, code: "robots_disallows" });
  });

  test("skips a page too large to read rather than reading part of one", async () => {
    const result = await fetchSite(
      {
        fetch: (input: string) =>
          Promise.resolve(
            String(input).endsWith("/robots.txt")
              ? respond("")
              : respond("<p>hi</p>", { "content-length": "999999999" }),
          ),
      },
      "example.com",
    );

    expect(result).toEqual({ ok: false, code: "nothing_readable" });
  });

  test("keeps going when one page fails and returns the ones that did not", async () => {
    const result = await fetchSite(
      {
        fetch: (input: string) => {
          const url = String(input);
          if (url.endsWith("/robots.txt")) return Promise.resolve(respond(""));
          if (url.endsWith("/pricing")) return Promise.reject(new Error("down"));
          if (url.endsWith("/about")) return Promise.resolve(new Response("", { status: 404 }));
          return Promise.resolve(respond("<p>For small agencies</p>"));
        },
      },
      "example.com",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected pages");

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages.every((page) => page.text === "For small agencies")).toBe(true);
    expect(result.pages.some((page) => page.url.endsWith("/pricing"))).toBe(false);
  });

  test("answers nothing_readable when every page fails", async () => {
    const result = await fetchSite(
      { fetch: () => Promise.reject(new Error("unreachable")) },
      "example.com",
    );

    expect(result).toEqual({ ok: false, code: "nothing_readable" });
  });
});
