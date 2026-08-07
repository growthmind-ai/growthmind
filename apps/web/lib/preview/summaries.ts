// The verdict sentence leads with its own call — "Kept. It reached the bar…" — so the list
// lead is read off the sentence rather than stored twice and allowed to disagree with it.
export function outcomeWordOf(verdict: string): string {
  return (
    verdict
      .trim()
      .split(/[.\s]/u)
      .find((word) => word.length > 0)
      ?.toUpperCase() ?? "—"
  );
}
