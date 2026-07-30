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

/**
 * Word-boundary matcher over a lowercased user agent:
 * `(^|[^a-z0-9])token([^a-z0-9]|$)`. `curl` fires; `curlyfont` does not.
 *
 * TYPED STUB (O-003 scaffold): signature is final; the body throws.
 */
export function matchesToken(_userAgent: string, _token: string): boolean {
  throw new Error("TYPED STUB (O-003 scaffold): matchesToken");
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
  "k6",
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
