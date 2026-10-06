export interface CommandContext {
  readonly activeActivity?: string;
  readonly bottomPanelOpen?: boolean;
  readonly bottomPanelTab?: string;
  readonly commandPaletteOpen?: boolean;
  readonly activePanelId?: string | null;
  readonly dataModelCount?: number;
  readonly exportDialogOpen?: boolean;
  readonly importDialogOpen?: boolean;
  readonly sceneModelCount?: number;
  readonly selectedDataObjectId?: string | null;
  readonly selectedObjectType?: string | null;
  readonly rendererMode?: string;
  readonly rendererSwitching?: boolean;
  readonly selectedObjectId?: string | null;
  readonly toolWindowOpen?: Record<string, boolean>;
}

export interface CommandExecutionEvent {
  readonly command: StudioCommand;
  readonly commandId: string;
  readonly payload?: unknown;
  readonly context: CommandContext;
  readonly status: "started" | "finished" | "failed" | "disabled" | "missing";
  readonly error?: unknown;
}

export interface StudioCommand {
  readonly id: string;
  readonly title: string;
  readonly category?: string;
  readonly shortcut?: string;
  readonly run: (payload?: unknown, context?: CommandContext) => void | Promise<void>;
  readonly enabled?: (context: CommandContext, payload?: unknown) => boolean;
  readonly visible?: (context: CommandContext) => boolean;
  readonly checked?: (context: CommandContext) => boolean;
}

export class CommandRegistry {
  private readonly _commands = new Map<string, StudioCommand>();
  private readonly _getContext: () => CommandContext;
  private readonly _listeners = new Set<(event: CommandExecutionEvent) => void>();
  private readonly _recentCommandIds: string[] = [];

  constructor(getContext: () => CommandContext = () => ({})) {
    this._getContext = getContext;
  }

  register(command: StudioCommand): void {
    if (this._commands.has(command.id)) {
      throw new Error(`[CommandRegistry] Command already registered: ${command.id}`);
    }
    if (command.shortcut) {
      const shortcut = normalizeShortcut(command.shortcut);
      const conflict = Array.from(this._commands.values()).find((other) => other.shortcut && normalizeShortcut(other.shortcut) === shortcut);
      if (conflict) {
        throw new Error(`[CommandRegistry] Shortcut ${command.shortcut} is already assigned to ${conflict.id}`);
      }
    }
    this._commands.set(command.id, command);
  }

  execute(commandId: string, payload?: unknown): void {
    const command = this._commands.get(commandId);
    const context = this._getContext();
    if (!command) {
      this._emit({command: missingCommand(commandId), commandId, payload, context, status: "missing"});
      throw new Error(`[CommandRegistry] Command not found: ${commandId}`);
    }
    if (command.enabled && !command.enabled(context, payload)) {
      this._emit({command, commandId, payload, context, status: "disabled"});
      return;
    }
    this._remember(commandId);
    this._emit({command, commandId, payload, context, status: "started"});
    try {
      const result = command.run(payload, context);
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>)
          .then(() => this._emit({command, commandId, payload, context, status: "finished"}))
          .catch((error) => this._emit({command, commandId, payload, context, status: "failed", error}));
      } else {
        this._emit({command, commandId, payload, context, status: "finished"});
      }
    } catch (error) {
      this._emit({command, commandId, payload, context, status: "failed", error});
      throw error;
    }
  }

  get(commandId: string): StudioCommand | null {
    return this._commands.get(commandId) || null;
  }

  isEnabled(commandId: string, payload?: unknown): boolean {
    const command = this._commands.get(commandId);
    if (!command) {
      return false;
    }
    return !command.enabled || command.enabled(this._getContext(), payload);
  }

  isChecked(commandId: string): boolean {
    return this._commands.get(commandId)?.checked?.(this._getContext()) || false;
  }

  isVisible(commandId: string): boolean {
    const command = this._commands.get(commandId);
    if (!command) {
      return false;
    }
    return !command.visible || command.visible(this._getContext());
  }

  list(params: {visibleOnly?: boolean} = {}): StudioCommand[] {
    const commands = Array.from(this._commands.values());
    const visibleCommands = params.visibleOnly ? commands.filter((command) => this.isVisible(command.id)) : commands;
    return visibleCommands.sort((a, b) =>
      (a.category || "").localeCompare(b.category || "") ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
    );
  }

  recent(limit = 8): StudioCommand[] {
    return this._recentCommandIds
      .map((commandId) => this._commands.get(commandId))
      .filter((command): command is StudioCommand => !!command && this.isVisible(command.id))
      .slice(0, limit);
  }

  onDidExecute(listener: (event: CommandExecutionEvent) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _remember(commandId: string): void {
    const existingIndex = this._recentCommandIds.indexOf(commandId);
    if (existingIndex !== -1) {
      this._recentCommandIds.splice(existingIndex, 1);
    }
    this._recentCommandIds.unshift(commandId);
    this._recentCommandIds.splice(16);
  }

  private _emit(event: CommandExecutionEvent): void {
    for (const listener of this._listeners) {
      listener(event);
    }
  }
}

function normalizeShortcut(shortcut: string): string {
  return shortcut.toLowerCase().split("+").map((part) => {
    const key = part.trim();
    return key === "cmd" || key === "meta" ? "ctrl" : key === "option" ? "alt" : key;
  }).sort().join("+");
}

function missingCommand(commandId: string): StudioCommand {
  return {
    id: commandId,
    title: commandId,
    run: () => {}
  };
}
