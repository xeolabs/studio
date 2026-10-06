import type {ExplorerSource} from "./types";
import {EXPLORER_SEARCH_LIMIT} from "./searchTreeEntries";

export interface ExplorerSession {
  branches: Map<string, boolean>;
  collectionBranches: Map<string, {expanded: boolean; pageIndex: number}>;
  focusedNodeId: string;
  scrollTop: number;
  scrollLeft: number;
  search: {query: string; browsing: boolean; limit: number; scrollTop: number};
}

/** Session-only UI state. No SDK instances or DOM nodes survive a panel's destruction. */
export class ExplorerSessions {
  private readonly sessions = new Map<ExplorerSource, ExplorerSession>();

  get(source: ExplorerSource): ExplorerSession {
    let session = this.sessions.get(source);
    if (!session) {
      session = {branches: new Map(), collectionBranches: new Map(), focusedNodeId: "", scrollTop: 0, scrollLeft: 0,
        search: {query: "", browsing: false, limit: EXPLORER_SEARCH_LIMIT, scrollTop: 0}};
      this.sessions.set(source, session);
    }
    return session;
  }
}
