export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

const CLOUD_API_HOST = /^https?:\/\/(us|eu)\.i\.posthog\.com$/;

export interface PostHogHosts {
  readonly apiHost: string;

  readonly assetsHost: string;

  readonly uiHost: string;
}

export interface PostHogHostEnv {
  readonly host?: string | undefined;
  readonly assetsHost?: string | undefined;
  readonly uiHost?: string | undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

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

export const POSTHOG_PROXY_PATH = "/ingest";
