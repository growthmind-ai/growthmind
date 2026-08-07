export function matchesToken(userAgent: string, token: string): boolean {
  const haystack = userAgent.toLowerCase();
  const needle = token.toLowerCase();
  if (haystack.length === 0 || needle.length === 0) return false;

  for (let from = 0; from <= haystack.length - needle.length;) {
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

  "jmeter",
  "gatling",
  "locust",
  "vegeta",
  "apachebench",
  "siege",
];

// `chatgpt-user` and `perplexity-user` were here and are not: both vendors document them as a
// request a person asked for, not a crawl, and the declared fail direction is that anything
// ambiguous is INCLUDED as real. Excluding them dropped real customer sessions — an under-count
// that reads to a founder as a product problem (B-008). `claudebot`, `gptbot` and
// `oai-searchbot` are genuine crawlers and stay.
//
// `openai` went with them, and had to: every OpenAI user agent carries `+https://openai.com/…`,
// so the bare vendor name matched ChatGPT-User through the URL and removing its own token
// changed nothing. GPTBot and OAI-SearchBot still fire on their own tokens.
export const CODING_AGENT_TOKENS: readonly string[] = [
  "claude-user",
  "claude-web",
  "claudebot",
  "anthropic-ai",
  "gptbot",
  "oai-searchbot",
  "perplexitybot",
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
