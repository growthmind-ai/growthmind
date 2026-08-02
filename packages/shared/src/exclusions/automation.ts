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
