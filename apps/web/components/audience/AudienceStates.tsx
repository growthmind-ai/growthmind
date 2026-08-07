import { Paper, Stack, Text } from "@mantine/core";

import { ButtonLink } from "@/components/ui/Links";
import { tapTargetStyle } from "@/components/ui/tap-target";
import type { NoWebsiteView, ReadFailedResearchView, ReadingView } from "@/lib/audience/read";

import classes from "./AudienceStates.module.css";
import { NameWebsiteCta } from "./NameWebsiteCta";

// The read failing is ours to fix, so this state carries no control — a button that
// repairs a fault we have not established would be worse than the plain instruction.
const READ_FAILED_HEADING = "We couldn't load your model just now.";
const READ_FAILED_BODY = "Nothing is lost — refresh to try again.";

export function AudienceReadFailed() {
  return (
    <Paper withBorder radius="sm" p="xl">
      <Stack gap="sm" align="center">
        <Text fw={700}>{READ_FAILED_HEADING}</Text>
        <Text size="sm" c="dimmed" ta="center" maw="56ch">
          {READ_FAILED_BODY}
        </Text>
      </Stack>
    </Paper>
  );
}

export function AudienceEmpty({ view }: { readonly view: NoWebsiteView }) {
  return (
    <Paper withBorder radius="sm" p="xl">
      <Stack gap="sm" align="center">
        <Text fw={700}>{view.title}</Text>
        <Text size="sm" c="dimmed" ta="center" maw="56ch">
          {view.body}
        </Text>
        <NameWebsiteCta cta={view.cta} />
      </Stack>
    </Paper>
  );
}

// A pulse rather than a spinner: the copy already says what will happen, and the beliefs
// arrive by push with no reload.
export function AudienceReading({ view }: { readonly view: ReadingView }) {
  return (
    <Paper withBorder radius="sm" p="xl" className={classes.reading}>
      <Text size="sm" c="dimmed" ta="center">
        {view.message}
      </Text>
    </Paper>
  );
}

export function AudienceResearchFailed({ view }: { readonly view: ReadFailedResearchView }) {
  return (
    <Paper withBorder radius="sm" p="xl">
      <Stack gap="sm" align="center">
        {/* The same weight its two sibling states open with: a failure whispered in dimmed
            small type reads as a footnote rather than the state of the page. */}
        <Text fw={700} ta="center" maw="56ch">
          {view.message}
        </Text>
        <ButtonLink href={view.cta.href} variant="default" size="compact-sm" style={tapTargetStyle}>
          {view.cta.label}
        </ButtonLink>
      </Stack>
    </Paper>
  );
}
