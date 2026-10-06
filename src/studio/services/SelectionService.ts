import type {View} from "@xeokit/sdk/viewing/viewer";
import {type ObjectSelectionDetails, ObjectSelectionDetailsResolver} from "./ObjectSelectionDetails";

export interface SelectionServiceParams {
  view: View;
  detailsResolver: ObjectSelectionDetailsResolver;
  onSelectionDetails: (details: ObjectSelectionDetails | null) => void;
}

export class SelectionService {
  private readonly _view: View;
  private readonly _detailsResolver: ObjectSelectionDetailsResolver;
  private readonly _onSelectionDetails: (details: ObjectSelectionDetails | null) => void;
  private _selectedSceneObjectId: string | null = null;
  private readonly _listeners = new Set<(id: string | null) => void>();

  constructor(params: SelectionServiceParams) {
    this._view = params.view;
    this._detailsResolver = params.detailsResolver;
    this._onSelectionDetails = params.onSelectionDetails;
  }

  get selectedSceneObjectId(): string | null {
    return this._selectedSceneObjectId;
  }

  onChanged(listener: (id: string | null) => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  resolveSceneObject(sceneObjectId: string): ObjectSelectionDetails | null {
    return this._detailsResolver.resolveSceneObject(sceneObjectId);
  }

  selectSceneObject(sceneObjectId: string | null): ObjectSelectionDetails | null {
    if (this._selectedSceneObjectId) {
      this._view.setObjectsInStyleBin("selected", [this._selectedSceneObjectId], false);
    }
    const details = sceneObjectId ? this.resolveSceneObject(sceneObjectId) : null;
    this._selectedSceneObjectId = details ? sceneObjectId : null;
    if (!details) {
      this._onSelectionDetails(null);
      for (const listener of this._listeners) listener(null);
      return null;
    }
    this._view.setObjectsInStyleBin("selected", [sceneObjectId], true);
    this._onSelectionDetails(details);
    for (const listener of this._listeners) listener(sceneObjectId);
    return details;
  }

  clear(): void {
    this.selectSceneObject(null);
  }
}
