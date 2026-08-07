// Focus alone leaves the caret at position 0 on a pre-filled editor, so the first thing a
// keyboard reader types is prefixed to the claim rather than continuing it.
export function focusAtEnd(field: HTMLTextAreaElement | null): void {
  if (field === null) return;

  field.focus();
  const end = field.value.length;
  field.setSelectionRange(end, end);
}
