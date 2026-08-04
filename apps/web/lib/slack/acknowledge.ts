import { logger } from "@growthmind/shared";

const ACKNOWLEDGEMENT_PROTOCOL = "https:";

const ACKNOWLEDGEMENT_HOST = "hooks.slack.com";

const ACKNOWLEDGEMENT_TIMEOUT_MS = 5000;

// `response_url` arrives inside the Slack payload, so it is an attacker-influenced address
// this server would otherwise POST to. A substring test accepts `hooks.slack.com.evil.test`.
export function isSlackAcknowledgementUrl(candidate: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== ACKNOWLEDGEMENT_PROTOCOL) return false;
  if (parsed.username !== "" || parsed.password !== "") return false;

  return parsed.host === ACKNOWLEDGEMENT_HOST;
}

export interface SlackAcknowledgement {
  readonly responseUrl: string;
  readonly text: string;
}

// `in_channel` is the audience decision: a queued fix belongs to the whole organization, so
// the teammates watching the channel see the button did something.
export async function postSlackAcknowledgement(input: SlackAcknowledgement): Promise<void> {
  if (!isSlackAcknowledgementUrl(input.responseUrl)) {
    logger.error(
      "slack interactivity: an acknowledgement address was not Slack's, so nothing was posted",
    );
    return;
  }

  // Following a redirect would move the post to an address the allow-list never saw.
  const response = await fetch(input.responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ response_type: "in_channel", text: input.text }),
    redirect: "manual",
    signal: AbortSignal.timeout(ACKNOWLEDGEMENT_TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.error("slack interactivity: Slack would not accept the acknowledgement", {
      status: response.status,
    });
  }
}
