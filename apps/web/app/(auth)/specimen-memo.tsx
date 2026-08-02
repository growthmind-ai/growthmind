import { Box, Text } from "@mantine/core";

import { MemoFields, MemoSheet, type MemoField } from "@/components/ui/Memo";

const FIELDS: readonly MemoField[] = [
  { label: "TO:", value: "The Founders" },
  { label: "FROM:", value: "Growthmind" },
  {
    label: "RE:",
    value: (
      <Text component="span" fw={700} inherit>
        Your invite step is where new teams stop.
      </Text>
    ),
  },
];

const FOOTNOTE = "SPECIMEN MEMO · FIGURES ILLUSTRATIVE, NOT CUSTOMER RESULTS";

export function SpecimenMemo() {
  return (
    <MemoSheet stamp="Specimen" footnote={FOOTNOTE}>
      <MemoFields fields={FIELDS} />

      <Text ff="var(--type)" fz={12} mt="sm" style={{ lineHeight: 1.85 }}>
        31 of the 200 people who started setup last week{" "}
        <Text
          component="span"
          inherit
          style={{ borderBottom: "2px solid var(--mantine-primary-color-4)" }}
        >
          closed the invite panel and never came back.
        </Text>{" "}
        The step asks for teammates before the product has proven itself to one person.
      </Text>

      <Box mt="md" p="sm" style={{ border: "1.5px solid var(--mantine-color-default-border)" }}>
        <Text ff="var(--type)" fz={11.5} style={{ lineHeight: 1.8 }}>
          <Text component="span" fw={700} inherit>
            RECOMMENDATION:
          </Text>{" "}
          let people skip the invite step.{" "}
          <Text
            component="span"
            inherit
            style={{
              background: "color-mix(in srgb, var(--mantine-primary-color-4) 38%, transparent)",
              padding: "0 2px",
            }}
          >
            Projected: 15 more people a week
          </Text>{" "}
          reaching first value. Written up for your coding assistant; awaiting your initials.
        </Text>
      </Box>

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
  );
}
