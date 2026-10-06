/** The part of Dockview's panel API needed by expensive diagnostic panels. */
export interface PanelVisibilityApi {
  readonly isVisible: boolean;
  onDidVisibilityChange(listener: (event: {isVisible: boolean}) => void): {dispose(): void};
}

/** Hidden tabs, closed panels and background browser pages must not run live sampling. */
export function observePanelActivity(
  api: PanelVisibilityApi | undefined,
  setActive: (active: boolean) => void,
  page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> = document
): () => void {
  let visible = api?.isVisible ?? true;
  const sync = () => setActive(visible && !page.hidden);
  const subscription = api?.onDidVisibilityChange(event => { visible = event.isVisible; sync(); });
  page.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    subscription?.dispose();
    page.removeEventListener("visibilitychange", sync);
    setActive(false);
  };
}
