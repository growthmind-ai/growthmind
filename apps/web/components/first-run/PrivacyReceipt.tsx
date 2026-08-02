import { Divider, Paper, Stack, Text } from "@mantine/core";
import { Fragment } from "react";

import {
  buildPrivacyReceipt,
  ONBOARDING_MESSAGES,
  type PrivacyReceiptInput,
} from "@growthmind/shared";

interface PrivacyReceiptProps {
  readonly input: PrivacyReceiptInput;
}

export function PrivacyReceipt({ input }: PrivacyReceiptProps) {
  const lines = buildPrivacyReceipt(input);

  return (
    <Stack gap={6}>
      <Paper withBorder radius="sm" p="sm" bg="var(--mantine-color-default)">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {ONBOARDING_MESSAGES.receiptTitle}
        </Text>
        <Stack gap={4} mt={6}>
          {lines.map((line, index) => (
            <Fragment key={line}>
              {index === 0 ? null : <Divider />}
              <Text size="xs" c="dimmed">
                {line}
              </Text>
            </Fragment>
          ))}
        </Stack>
      </Paper>
      <Text size="xs" c="dimmed">
        {ONBOARDING_MESSAGES.receiptClosing}
      </Text>
    </Stack>
  );
}
