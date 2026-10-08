export type WorkspaceLayout = "compact" | "medium" | "wide";

/** Keep the shell within the visible viewport, including the on-screen keyboard. */
export function observeWorkspaceLayout(onChange: (layout: WorkspaceLayout) => void): () => void {
  const compact = matchMedia("(max-width: 959px), (max-height: 600px)");
  const wide = matchMedia("(min-width: 1200px) and (min-height: 601px)");
  const abort = new AbortController();
  const options = {signal: abort.signal};
  const resize = () => {
    const viewport = window.visualViewport;
    const unzoomed = viewport?.scale === 1;
    document.documentElement.style.setProperty("--studio-app-height", `${unzoomed ? viewport.height : window.innerHeight}px`);
    document.documentElement.style.setProperty("--studio-app-top", `${unzoomed ? viewport.offsetTop : 0}px`);
    onChange(compact.matches ? "compact" : wide.matches ? "wide" : "medium");
  };
  compact.addEventListener("change", resize, options);
  wide.addEventListener("change", resize, options);
  window.addEventListener("resize", resize, options);
  window.visualViewport?.addEventListener("resize", resize, options);
  window.visualViewport?.addEventListener("scroll", resize, options);
  resize();
  return () => {
    abort.abort();
    document.documentElement.style.removeProperty("--studio-app-height");
    document.documentElement.style.removeProperty("--studio-app-top");
  };
}
