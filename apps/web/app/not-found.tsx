import { Box, Center, Group, Text } from "@mantine/core";
import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/Links";
import { MemoFields, MemoSheet, type MemoField } from "@/components/ui/Memo";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Page not found — Growthmind",
};

const FIELDS: readonly MemoField[] = [
  { label: "TO:", value: "You, mid-click" },
  { label: "FROM:", value: "Growthmind" },
  {
    label: "RE:",
    value: (
      <Text component="span" fw={700} inherit>
        This page doesn&apos;t exist.
      </Text>
    ),
  },
];

const FOOTNOTE = "FILED AUTOMATICALLY · HTTP 404 · THIS FINDING RESOLVES ITSELF WHEN YOU LEAVE";

export default function NotFound() {
  return (
    <Center mih="100dvh" p="md" py="xl">
      <Box w="100%" maw={430}>
        <MemoSheet department="INTEROFFICE · DEAD-END DIVISION" stamp="404" footnote={FOOTNOTE}>
          <MemoFields fields={FIELDS} />

          <Text ff="var(--type)" fz={12} mt="sm" style={{ lineHeight: 1.85 }}>
            1 of 1 sessions on this URL (100%){" "}
            <Text
              component="span"
              inherit
              style={{ borderBottom: "2px solid var(--mantine-primary-color-4)" }}
            >
              reached a dead end just now.
            </Text>{" "}
            The evidence points to a page that was never built, moved without telling anyone, or a
            link that promised more than it could deliver. We take dead ends personally — finding
            them is the whole business.
          </Text>

          <Box mt="md" p="sm" style={{ border: "1.5px solid var(--mantine-color-default-border)" }}>
            <Text ff="var(--type)" fz={11.5} style={{ lineHeight: 1.8 }}>
              <Text component="span" fw={700} inherit>
                RECOMMENDATION:
              </Text>{" "}
              every dead end should name its next step.{" "}
              <Text
                component="span"
                inherit
                style={{
                  background: "color-mix(in srgb, var(--mantine-primary-color-4) 38%, transparent)",
                  padding: "0 2px",
                }}
              >
                Yours is the button below.
              </Text>{" "}
              Projected: 1 of 1 visitors (100%) back on a page that exists.
            </Text>
          </Box>

          <Group mt="md">
            <ButtonLink href={ROUTES.home}>Back to the app</ButtonLink>
          </Group>

          <Text ff="var(--type)" fz={11.5} c="dimmed" mt="md">
            Respectfully submitted,{" "}
            <Text
              component="span"
              ff="var(--type)"
              fz={16}
              style={{ color: "var(--mantine-color-text)" }}
            >
              — Growthmind
            </Text>
          </Text>
        </MemoSheet>
      </Box>
    </Center>
  );
}
