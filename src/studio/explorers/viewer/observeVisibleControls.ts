/** Samples controls only while their explorer is on screen. SDK objects remain non-reactive. */
export function observeVisibleControls(container: HTMLElement, refresh: () => void): () => void {
  let visible = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const canSample = () => visible && !document.hidden && !disposed &&
    (container.checkVisibility ? container.checkVisibility({checkVisibilityCSS: true, checkOpacity: true})
      : getComputedStyle(container).visibility === "visible");
  const sample = () => {
    timer = undefined;
    if (!canSample()) return;
    refresh();
    timer = setTimeout(sample, 125);
  };
  const schedule = () => {
    if (!canSample()) { clearTimeout(timer); timer = undefined; }
    else if (timer === undefined) sample();
  };
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    schedule();
  });
  observer.observe(container);
  // Docked tabs may retain their geometry but become visibility:hidden.
  const styles = new MutationObserver(schedule);
  for (let parent: HTMLElement | null = container; parent; parent = parent.parentElement) {
    styles.observe(parent, {attributes: true, attributeFilter: ["style", "class", "hidden"]});
  }
  document.addEventListener("visibilitychange", schedule);
  return () => {
    disposed = true;
    clearTimeout(timer);
    observer.disconnect();
    styles.disconnect();
    document.removeEventListener("visibilitychange", schedule);
  };
}
