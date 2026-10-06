/** Do not use scrollIntoView here: Dockview's hidden overlays can scroll the workspace itself. */
export function scrollExplorerRowIntoView(row: HTMLElement, host: HTMLElement, align: "nearest" | "center" = "nearest"): void {
  for (let parent = row.parentElement; parent && parent !== host; parent = parent.parentElement) {
    if (!/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) continue;
    const bounds = parent.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    const delta = align === "center" ? target.top - bounds.top - (bounds.height - target.height) / 2
      : target.top < bounds.top ? target.top - bounds.top
      : target.bottom > bounds.bottom ? target.bottom - bounds.bottom : 0;
    parent.scrollTop += delta;
    return;
  }
}
