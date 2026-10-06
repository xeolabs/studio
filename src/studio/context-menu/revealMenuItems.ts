import type {CommandRegistry} from "../commands/CommandRegistry";
import {REVEAL_DESTINATIONS} from "../explorers/revealDestinations";
import {commandItem} from "./explorerMenuItems";

export function revealMenuItems(commands: CommandRegistry, objectId: string | null, currentSource?: string) {
  if (!objectId) return [];
  const payload = {objectId};
  return REVEAL_DESTINATIONS.filter((item) => item.source !== currentSource && commands.isEnabled(item.commandId, payload))
    .map((item) => commandItem(commands, item.commandId, item.commandId, {payload}));
}
