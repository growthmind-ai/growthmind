// THE PRIVACY POSTURE RECEIPT — A RECEIPT, NOT A SETTINGS PANEL
// (O-008, AD-2, FR-O8, PRD ruling R2, UX Checklist row 11).
//
// ###########################################################################
// # NOTHING IN HERE IS A CONTROL, AND THAT IS THE POINT.
// #
// # No input, no toggle, no picker, no save. `buildPrivacyReceipt` returns
// # plain strings, so there is no property a control could hang off — the same
// # technique AD-19 uses on the stub arm, applied to the same class of quiet
// # regression. A reader asking "are you sending my users' personal data
// # anywhere?" is owed an answer, not a form.
// #
// # SEVEN LINES, AND THE CLOSING LINE IS NOT ONE OF THEM. It renders BENEATH
// # the block because it is the sentence that makes the block a receipt; a
// # line inside the block offering to switch something on is exactly what the
// # receipt's own audit forbids, and would make it contradict itself in one
// # paragraph.
// #
// # THE COUNT NEVER MOVES WITH THE INPUT. The no-domain case substitutes a
// # sentence at the same index rather than dropping one — a six-line receipt
// # in the case where we know least is the case where the seventh line matters
// # most. That is `buildPrivacyReceipt`'s guarantee; this file simply renders
// # what it is handed, in order.
// ###########################################################################
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
