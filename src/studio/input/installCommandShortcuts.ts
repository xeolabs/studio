import type {CommandRegistry} from "../commands/CommandRegistry";

export interface CommandShortcutInstallerParams {
  commands: CommandRegistry;
}

export function installCommandShortcuts(params: CommandShortcutInstallerParams): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || modalIsOpen() || document.querySelector(".studio-context-menu")) {
      return;
    }
    if ((event.target as HTMLElement)?.closest?.('[role="treeitem"]') && ["Home", "End", " "].includes(event.key)) return;
    for (const command of params.commands.list({visibleOnly: true})) {
      if (!command.shortcut || !matchesShortcut(event, command.shortcut)) {
        continue;
      }
      if (isEditableTarget(event.target) && command.id !== "studio.commandPalette") {
        continue;
      }
      if (!params.commands.isEnabled(command.id)) {
        continue;
      }
      event.preventDefault();
      params.commands.execute(command.id);
      return;
    }
  };
  window.addEventListener("keydown", onKeydown, true);
  return () => window.removeEventListener("keydown", onKeydown, true);
}

function modalIsOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
    .some((dialog) => dialog.getClientRects().length > 0);
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  const key = parts[parts.length - 1];
  const wantsCommand = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt") || parts.includes("option");
  if (wantsCommand !== (event.ctrlKey || event.metaKey)) {
    return false;
  }
  if (wantsShift !== event.shiftKey || wantsAlt !== event.altKey) {
    return false;
  }
  return normalizeKey(event.key) === normalizeKey(key);
}

function normalizeKey(key: string | undefined): string {
  const value = (key || "").toLowerCase();
  if (value === " ") {
    return "space";
  }
  return value;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}
