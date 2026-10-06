import type {ExplorerSession} from "./ExplorerSessions";
import type {NavigableExplorerStore} from "./types";
import {ExplorerExpansionState} from "./ExplorerExpansionState";
import {EXPLORER_ROW_SELECTOR} from "./explorerSelection";

const ROOTS = ".xeokit-data-tree-roots, .xeokit-data-explorer-roots, .xeokit-scene-tree-roots, .xeokit-viewer-explorer-roots";

/** Replays lazy expansion first; restores scrolling only after the host has a layout. */
export function bindExplorerSession(container: HTMLElement, store: NavigableExplorerStore, session: ExplorerSession,
  watchRevision: (callback: () => void) => () => void, nextRender: () => Promise<void>) {
  const expansion = new ExplorerExpansionState(session.branches);
  let disposed = false;
  let restoring = true;
  let scrollRestored = false;
  const scroller = () => container.querySelector<HTMLElement>(ROOTS);
  const restoreScroll = () => {
    const root = scroller();
    if (disposed || restoring || scrollRestored || !root?.clientHeight) return;
    root.scrollTop = session.scrollTop;
    root.scrollLeft = session.scrollLeft;
    scrollRestored = true;
  };
  const saveScroll = (event: Event) => {
    const root = scroller();
    if (!scrollRestored || event.target !== root || !root.clientHeight) return;
    session.scrollTop = root.scrollTop;
    session.scrollLeft = root.scrollLeft;
  };
  const saveFocus = (event: Event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(EXPLORER_ROW_SELECTOR);
    if (row) session.focusedNodeId = row.dataset.nodeId || "";
  };
  const resize = new ResizeObserver(restoreScroll);
  resize.observe(container);
  const unwatch = watchRevision(() => { void expansion.restore(store, () => !disposed); });
  container.addEventListener("scroll", saveScroll, true);
  container.addEventListener("focusin", saveFocus);
  const ready = (async () => {
    if (session.collectionBranches.size) store.restoreBranchStates?.(session.collectionBranches);
    await expansion.restore(store, () => !disposed);
    await nextRender();
    restoring = false;
    restoreScroll();
  })();
  return {ready, dispose() {
    expansion.capture(store);
    session.collectionBranches = store.captureBranchStates?.() || session.collectionBranches;
    disposed = true;
    unwatch(); resize.disconnect();
    container.removeEventListener("scroll", saveScroll, true);
    container.removeEventListener("focusin", saveFocus);
  }};
}
