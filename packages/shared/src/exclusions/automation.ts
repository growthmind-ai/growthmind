// Automation detection over the user-agent string (O-003 F-4/F-5/F-6/F-7).
//
// Three separately-named classes, because the counter's breakdown has to
// explain the gap in the customer's own terms (product-decisions §4 lists
// coding agents as their own class).
//
// FAIL DIRECTIONS:
//   F-4 headless/E2E — CONFIDENT EXCLUDE, the one named exception. A real
//       human is essentially never on HeadlessChrome / Playwright /
//       Puppeteer / Cypress / Selenium / WebDriver / PhantomJS, and
//       product-decisions §4 states outright that "Playwright traffic in CI
//       will wreck an activation funnel".
//   F-5 known agent — toward INCLUDING as real for anything ambiguous. The
//       list is narrow, high-precision, and whole-token only. A broad
//       heuristic is the D10 superset failure with a friendly name.
//   F-6 coding agent — same as F-5.
//   F-7 absent UA — toward INCLUDING as real. SEC-A pinned that PostHog does
//       NOT derive a user agent server-side, so a server-side or minimal SDK
//       sends none at all; classifying that as a bot would silently drop real
//       sessions.
//
// There is deliberately NO token that is a bare substring of an ordinary
// word. In particular there is no bare `bot` token: `Abbott`, `robotics`, and
// `Botim` must never fire, and the required near-miss fixtures exist so a
// future contributor who adds one gets a red test.
//
// THE RULE FOR ADDING A TOKEN, learned the hard way (see the removed `k6`
// below): word-boundary matching only protects a token from being swallowed
// by a longer WORD. It does nothing about a token that appears as its own
// delimited fragment inside an ordinary user agent — a device model
// (`SM-K6`), an OS build string, or a browser name. So before adding a token,
// ask whether it could appear between two punctuation characters in a real
// person's user agent. Anything under about four characters almost certainly
// can, and belongs nowhere near these lists.

/**
 * Word-boundary matcher over a lowercased user agent, equivalent to
 * `(^|[^a-z0-9])token([^a-z0-9]|$)`. `curl` fires; `curlyfont` does not.
 *
 * Written as a scan rather than a built regex on purpose: tokens carry `.`,
 * `-`, and spaces (`bolt.new`, `chrome-lighthouse`, `screaming frog seo
 * spider`), and an unescaped one interpolated into a pattern would quietly
 * become a wildcard — a rule that fires on a superset of its target with no
 * error to notice. A scan also handles overlapping occurrences, so a token
 * appearing twice cannot be missed because its first occurrence lost its
 * boundary.
 *
 * FAIL DIRECTION: toward NOT matching. An empty user agent or an empty token
 * is not a match (F-7), and a token embedded inside a longer word is not a
 * match — because every caller of this function excludes a session on a hit.
 */
export function matchesToken(userAgent: string, token: string): boolean {
  const haystack = userAgent.toLowerCase();
  const needle = token.toLowerCase();
  if (haystack.length === 0 || needle.length === 0) return false;

  for (let from = 0; from <= haystack.length - needle.length; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;

    const before = at === 0 ? "" : (haystack[at - 1] ?? "");
    const after = haystack[at + needle.length] ?? "";
    if (!isAlphanumeric(before) && !isAlphanumeric(after)) return true;

    from = at + 1;
  }
  return false;
}

function isAlphanumeric(character: string): boolean {
  return character.length === 1 && /[a-z0-9]/.test(character);
}

/** F-4. Headless browsers and E2E drivers — the confident-exclude class. */
export const HEADLESS_TOKENS: readonly string[] = [
  "headless",
  "headlesschrome",
  "headlessfirefox",
  "chrome-headless-shell",
  "playwright",
  "puppeteer",
  "cypress",
  "selenium",
  "webdriver",
  "chromedriver",
  "geckodriver",
  "phantomjs",
  "htmlunit",
  "nightmare",
  "testcafe",
  "puppeteersharp",
  "katalon",
  "appium",
];

/** F-5. Crawlers, uptime monitors, auditors, and scripted HTTP clients. */
export const KNOWN_AGENT_TOKENS: readonly string[] = [
  "googlebot",
  "adsbot-google",
  "mediapartners-google",
  "bingbot",
  "bingpreview",
  "yandexbot",
  "duckduckbot",
  "baiduspider",
  "slurp",
  "sogou",
  "exabot",
  "applebot",
  "petalbot",
  "bytespider",
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "seznambot",
  "screaming frog seo spider",
  "chrome-lighthouse",
  "lighthouse",
  "pagespeed",
  "gtmetrix",
  "pingdom",
  "uptimerobot",
  "statuscake",
  "site24x7",
  "datadog synthetics",
  "newrelicpinger",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "slack-imgproxy",
  "discordbot",
  "telegrambot",
  "curl",
  "wget",
  "libwww-perl",
  "python-requests",
  "python-httpx",
  "aiohttp",
  "go-http-client",
  "okhttp",
  "axios",
  "node-fetch",
  "postmanruntime",
  "insomnia",
  // REMOVED, deliberately: the load-test tool `k6`.
  //
  // Word-boundary matching is `(^|[^a-z0-9])token([^a-z0-9]|$)`, and a real
  // Android device model reaches us as `...; SM-K6)`. Lowercased, `k6` there
  // sits between `-` and `)` — both non-alphanumeric — so the token MATCHED
  // and a real person's session was set aside as load-test traffic. That is
  // exactly the F-5 superset failure the near-miss fixtures exist to prevent,
  // and it was sitting in this list.
  //
  // A `/`-delimited variant (`k6/`, matching how k6 identifies itself as
  // `k6/0.49.0`) does not fix it either: the leading boundary still admits
  // `SM-K6/1.0`. Two characters is simply too short to carry a boundary rule,
  // so the token is gone. F-5's declared direction settles it — anything
  // ambiguous is INCLUDED as real. Load-test traffic is rare, self-inflicted,
  // and visible; a silently erased customer session is none of those.
  "jmeter",
  "gatling",
  "locust",
  "vegeta",
  "apachebench",
  "siege",
];

/**
 * F-6. The customer's own coding agents browsing their app
 * (product-decisions §4). Whole-token only — a UA merely containing the word
 * `agent` (`user-agent`, `AgentSmithBrowser`) must not fire.
 */
export const CODING_AGENT_TOKENS: readonly string[] = [
  "claude-user",
  "claude-web",
  "claudebot",
  "anthropic-ai",
  "chatgpt-user",
  "gptbot",
  "oai-searchbot",
  "openai",
  "perplexitybot",
  "perplexity-user",
  "cursor",
  "windsurf",
  "codeium",
  "devin",
  "cline",
  "aider",
  "copilot",
  "github-copilot",
  "replit",
  "bolt.new",
  "lovable",
  "v0.dev",
  "browserbase",
  "browserless",
  "stagehand",
];
