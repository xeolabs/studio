import type {ImportDataSet} from "../importing/ImportDataSet";
import type {ImportFileSlotState} from "./importDialogState";

export function createSlots(dataSet: ImportDataSet): Record<string, ImportFileSlotState> {
  const slots: Record<string, ImportFileSlotState> = {};
  for (const file of dataSet.files) {
    slots[file.key] = {
      key: file.key,
      file: null,
      fileName: "",
      url: ""
    };
  }
  return slots;
}

export function pickById<T extends {id: string}>(list: ReadonlyArray<T>, id: string): T {
  return list.find((item) => item.id === id) || list[0];
}
