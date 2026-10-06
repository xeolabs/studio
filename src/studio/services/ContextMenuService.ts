export type StudioContextMenuItem =
  | StudioContextMenuActionItem
  | StudioContextMenuSeparatorItem;

export interface StudioContextMenuActionItem {
  readonly type?: "action";
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
  readonly action: () => void | Promise<void>;
}

export interface StudioContextMenuSeparatorItem {
  readonly type: "separator";
  readonly id: string;
}

export interface StudioContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: StudioContextMenuItem[];
}

export function createContextMenuState(): StudioContextMenuState {
  return {
    open: false,
    x: 0,
    y: 0,
    items: []
  };
}

export class ContextMenuService {
  readonly state: StudioContextMenuState;

  constructor(state: StudioContextMenuState = createContextMenuState()) {
    this.state = state;
  }

  openAt(x: number, y: number, items: StudioContextMenuItem[]): void {
    const visibleItems = trimSeparators(items);
    if (visibleItems.length === 0) {
      this.close();
      return;
    }
    this.state.x = x;
    this.state.y = y;
    this.state.items = visibleItems;
    this.state.open = true;
  }

  close(): void {
    this.state.open = false;
    this.state.items = [];
  }
}

export function separator(id: string): StudioContextMenuSeparatorItem {
  return {type: "separator", id};
}

function trimSeparators(items: StudioContextMenuItem[]): StudioContextMenuItem[] {
  const trimmed: StudioContextMenuItem[] = [];
  let previousWasSeparator = true;
  for (const item of items) {
    if (item.type === "separator") {
      if (!previousWasSeparator) {
        trimmed.push(item);
      }
      previousWasSeparator = true;
      continue;
    }
    trimmed.push(item);
    previousWasSeparator = false;
  }
  while (trimmed[trimmed.length - 1]?.type === "separator") {
    trimmed.pop();
  }
  return trimmed;
}
