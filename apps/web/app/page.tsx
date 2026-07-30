import { Anchor, Container, Group, List, ListItem, Stack, Text, Title } from "@mantine/core";

import { LogoMark, LogoWordmark } from "../components/ui/Logo";

// Server component by convention — client logic lives in separate
// "use client" components (see AGENTS.md).
export default function HomePage() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="md">
        <Group gap="xs">
          <LogoMark size={34} />
          <Title order={1} size="h2">
            <LogoWordmark size={24} />
          </Title>
        </Group>
        <Text>
          Build a product people actually use — then use again. Growthmind watches real people use
          your product, finds where they get stuck, and tells you in Slack — one finding at a time,
          with the session recording and the numbers attached.
        </Text>
        <Text>
          This install is a pre-release scaffold: the platform is being built in the open and the
          implementation is landing now. What exists today:
        </Text>
        <List>
          <ListItem>
            The <Anchor href="/api/health">health endpoint</Anchor>, which also reports whether the
            database is reachable.
          </ListItem>
          <ListItem>
            The published{" "}
            <Anchor href="https://github.com/growthmind-ai/growthmind/blob/main/docs/product-decisions.md">
              product decisions
            </Anchor>{" "}
            and{" "}
            <Anchor href="https://github.com/growthmind-ai/growthmind/blob/main/docs/architecture.md">
              architecture
            </Anchor>{" "}
            this codebase is built against.
          </ListItem>
        </List>
        <Text c="dimmed">
          Follow along or argue with a decision at{" "}
          <Anchor href="https://github.com/growthmind-ai/growthmind">
            github.com/growthmind-ai/growthmind
          </Anchor>
          .
        </Text>
      </Stack>
    </Container>
  );
}
