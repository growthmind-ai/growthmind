export const SITE_PAGE_LIMIT = 8;

export const SITE_BYTE_LIMIT = 300_000;

export const SITE_TIMEOUT_MS = 10_000;

export const SITE_TEXT_LIMIT = 12_000;

// Where a product says who it is for. Read, never changed — §5 governs proposing changes
// to a pricing page, not learning from one that it is where money is asked for.
export const SITE_PATHS: readonly string[] = [
  "/",
  "/pricing",
  "/product",
  "/about",
  "/customers",
  "/use-cases",
  "/docs",
  "/features",
];

export type SiteFetchFailure =
  "domain_unreadable" | "robots_disallows" | "nothing_readable" | "call_failed";

export interface FetchedPage {
  readonly url: string;

  readonly text: string;
}

export type SiteFetchResult =
  | { readonly ok: true; readonly pages: readonly FetchedPage[] }
  | { readonly ok: false; readonly code: SiteFetchFailure };

// Narrower than `typeof fetch` on purpose: this reads pages and nothing else, so a caller
// supplying one function satisfies it without also standing up `preconnect`.
export type SiteFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SiteFetchDeps {
  readonly fetch: SiteFetch;
}

// A person names this and the server fetches it, so the name is an SSRF surface. The
// letters-only suffix above already refuses every IP literal (`127.0.0.1`,
// `169.254.169.254`); these refuse the names that resolve inward by word.
//
// It does not defend against a public name whose DNS points at a private address. That
// needs resolution-time checks this tier does not do, and what it leaves is an
// authenticated member making the server fetch a host and read a summary back.
const INWARD = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp)$/i;

export function originOf(domain: string): string | null {
  const trimmed = domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (trimmed.length === 0 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
    return null;
  }

  if (INWARD.test(trimmed)) {
    return null;
  }

  return `https://${trimmed.toLowerCase()}`;
}

// Only `User-agent: *`, and only `Disallow`. A partial reading that errs toward not
// fetching is the right kind of wrong for someone else's server.
export function disallowedPaths(robots: string): readonly string[] {
  const lines = robots.split("\n").map((line) => line.trim());
  const disallowed: string[] = [];
  let inStar = false;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = (rawKey ?? "").toLowerCase().trim();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inStar = value === "*";
      continue;
    }

    if (inStar && key === "disallow" && value.length > 0) {
      disallowed.push(value);
    }
  }

  return disallowed;
}

export function isAllowed(path: string, disallowed: readonly string[]): boolean {
  return !disallowed.some((rule) => (rule === "/" ? true : path.startsWith(rule)));
}

// Tags out, entities in, whitespace collapsed, then capped. Nothing here tries to be a
// parser — the model reads prose, and a page that needs a real DOM to understand is a page
// this tier is not for.
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SITE_TEXT_LIMIT);
}

async function readCapped(response: Response): Promise<string | null> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > SITE_BYTE_LIMIT) {
    return null;
  }

  const body = await response.text();

  return body.length > SITE_BYTE_LIMIT ? null : body;
}

async function getWithTimeout(deps: SiteFetchDeps, url: string): Promise<Response | null> {
  try {
    return await deps.fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
  } catch {
    return null;
  }
}

export async function fetchSite(deps: SiteFetchDeps, domain: string): Promise<SiteFetchResult> {
  const origin = originOf(domain);
  if (origin === null) {
    return { ok: false, code: "domain_unreadable" };
  }

  const robotsResponse = await getWithTimeout(deps, `${origin}/robots.txt`);
  const robots = robotsResponse?.ok === true ? await robotsResponse.text().catch(() => "") : "";
  const disallowed = disallowedPaths(robots);

  const allowed = SITE_PATHS.filter((path) => isAllowed(path, disallowed));
  if (allowed.length === 0) {
    return { ok: false, code: "robots_disallows" };
  }

  const pages: FetchedPage[] = [];
  for (const path of allowed.slice(0, SITE_PAGE_LIMIT)) {
    const url = `${origin}${path}`;
    const response = await getWithTimeout(deps, url);
    if (response === null || !response.ok) continue;

    const body = await readCapped(response).catch(() => null);
    if (body === null) continue;

    const text = textOf(body);
    if (text.length > 0) pages.push({ url, text });
  }

  return pages.length === 0 ? { ok: false, code: "nothing_readable" } : { ok: true, pages };
}
