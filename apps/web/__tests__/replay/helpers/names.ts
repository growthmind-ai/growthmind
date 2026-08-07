// The filter pill and the option row name themselves through `aria-labelledby` pointing at their
// own text nodes: session replay masks text and cannot mask an attribute, so a customer's own
// value may never reach `aria-label` (B-049). Reading a name is therefore a walk, not one
// attribute, and these helpers are what the pill suites assert names through.

export function domOf(markup: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}

function byId(root: ParentNode, id: string): Element | null {
  for (const element of root.querySelectorAll("[id]")) {
    if (element.getAttribute("id") === id) return element;
  }

  return null;
}

export function nameOf(root: ParentNode, element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");

  const text =
    labelledBy === null
      ? (element.getAttribute("aria-label") ?? element.textContent ?? "")
      : labelledBy
          .split(/\s+/u)
          .map((id) => byId(root, id)?.textContent ?? "")
          .join(" ");

  return text.replace(/\s+/gu, " ").trim();
}

export function pillsOf(root: ParentNode): readonly Element[] {
  return [...root.querySelectorAll('button[aria-haspopup="dialog"]')];
}

export function accentedPillNames(markup: string): readonly string[] {
  const host = domOf(markup);

  return pillsOf(host)
    .filter((pill) => pill.getAttribute("data-variant") === "filled")
    .map((pill) => nameOf(host, pill));
}
