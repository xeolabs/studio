/** Explicit context-menu targets take precedence over the working selection. */
export interface ObjectCommandTarget {
  sceneObjectId: string;
}

export function commandObjectId(payload: unknown, selectedId: string | null | undefined): string | null {
  if (payload === undefined) {
    return selectedId || null;
  }
  if (payload && typeof payload === "object" && "sceneObjectId" in payload && typeof payload.sceneObjectId === "string") {
    return payload.sceneObjectId || null;
  }
  return null;
}
