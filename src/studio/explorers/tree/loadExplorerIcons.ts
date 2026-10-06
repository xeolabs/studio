import {Copy, SlidersHorizontal, ChevronLeft, ChevronRight} from "lucide-vue-next";

export interface ExplorerIcons {Copy?: unknown; SlidersHorizontal?: unknown; ChevronLeft?: unknown; ChevronRight?: unknown;}

export async function loadExplorerIcons(): Promise<ExplorerIcons> {
  return {Copy, SlidersHorizontal, ChevronLeft, ChevronRight};
}
