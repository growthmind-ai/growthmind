/**
 * Where Growthmind sends its OWN product analytics — resolved from env, never pinned
 * to a region.
 *
 * ── SCOPE. THIS IS NOT CUSTOMER ANALYTICS ───────────────────────────────────
 *
 * These hosts are for Growthmind instrumenting itself (`user_signed_up`,
 * `user_signed_in`). A CUSTOMER's PostHog credentials never come from env — they
 * live encrypted in `project_connections`, because a global env key would be a
 * single-tenant design in a multi-tenant product. The `POSTHOG_*` variables in
 * `.env.example` are a third, unrelated thing again: the spike harnesses under
 * `scripts/spikes/`. Three PostHog integrations, three homes, no shared keys.
 *
 * ── WHY A RESOLVER AND NOT THREE `process.env` READS ────────────────────────
 *
 * PostHog Cloud splits one logical deployment across THREE origins, and a
 * self-hosted PostHog collapses all three onto one:
 *
 *   | Deployment    | api (ingest)          | static assets                | UI                 |
 *   |---------------|-----------------------|------------------------------|--------------------|
 *   | Cloud EU      | eu.i.posthog.com      | eu-assets.i.posthog.com      | eu.posthog.com     |
 *   | Cloud US      | us.i.posthog.com      | us-assets.i.posthog.com      | us.posthog.com     |
 *   | Self-hosted   | posthog.acme.com      | posthog.acme.com             | posthog.acme.com   |
 *
 * These origins were hardcoded to the EU trio in `next.config.ts` and
 * `instrumentation-client.ts`, so a US-region or self-hosted deployment proxied
 * its events to PostHog's EU cloud — a silent cross-region send that no error
 * would ever report. Self-hostability is first-class here (product decisions
 * ), so region cannot be a constant.
 *
 * The self-hosted case is therefore the DEFAULT SHAPE: set one variable
 * (`NEXT_PUBLIC_POSTHOG_HOST`) and the other two follow it. Cloud is the case
 * that needs the split, and it is derived from the well-known cloud hostnames so
 * a cloud user also sets only one. Either can be overridden explicitly.
 *
 * ── THE `NEXT_PUBLIC_` PREFIX IS LOAD-BEARING ───────────────────────────────
 *
 * Next.js inlines `NEXT_PUBLIC_*` into the client bundle at BUILD time, and only
 * where the source literally writes `process.env.NEXT_PUBLIC_FOO`. That is why
 * callers read the literals themselves and pass them in, rather than this module
 * reading `process.env` — a dynamic lookup inlines to nothing and the browser
 * silently gets `undefined`.
 */

/** The one origin every deployment has. Kept as the shipped EU-cloud default. */
export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

/** PostHog Cloud's api origin, e.g. `https://eu.i.posthog.com`. */
const CLOUD_API_HOST = /^https?:\/\/(us|eu)\.i\.posthog\.com$/;

/** The three origins a PostHog deployment is reached on. */
export interface PostHogHosts {
  /** Event ingestion. What `posthog-node` posts to and the proxy forwards to. */
  readonly apiHost: string;
  /** `array.js` / `static/*`. Same origin as the api unless Cloud splits it. */
  readonly assetsHost: string;
  /** Human-facing PostHog. Only used to build links back into the product. */
  readonly uiHost: string;
}

/** The raw env values, exactly as the caller read them off `process.env`. */
export interface PostHogHostEnv {
  readonly host?: string | undefined;
  readonly assetsHost?: string | undefined;
  readonly uiHost?: string | undefined;
}

/**
 * Trim, drop trailing slashes, and treat blank as absent.
 *
 * An empty string is what a declared-but-unset variable looks like in a `.env`
 * file (`NEXT_PUBLIC_POSTHOG_HOST=`), and `""` is falsy but would defeat `??`.
 * A trailing slash matters because these are concatenated into rewrite
 * destinations, where `host//static/:path*` is a 404.
 */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve all three origins from (possibly absent) env values.
 *
 * Self-hosted is the default shape: with only `host` set, all three collapse
 * onto it, which is exactly right for a single-origin PostHog. A recognised
 * Cloud api host expands into Cloud's asset and UI origins instead. An explicit
 * override always wins over both.
 */
export function resolvePostHogHosts(env: PostHogHostEnv): PostHogHosts {
  const apiHost = clean(env.host) ?? DEFAULT_POSTHOG_HOST;
  const region = CLOUD_API_HOST.exec(apiHost)?.[1];

  return {
    apiHost,
    assetsHost:
      clean(env.assetsHost) ?? (region ? `https://${region}-assets.i.posthog.com` : apiHost),
    uiHost: clean(env.uiHost) ?? (region ? `https://${region}.posthog.com` : apiHost),
  };
}

/**
 * The path the app proxies PostHog through, so an ad-blocker cannot drop the
 * app's own analytics. `next.config.ts` rewrites it; the browser SDK posts to it.
 * One constant because a mismatch between the two is a silent no-op.
 */
export const POSTHOG_PROXY_PATH = "/ingest";
