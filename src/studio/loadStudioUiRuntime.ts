import * as Vue from "vue";
import * as Pinia from "pinia";
import ElementPlus, {ElMessageBox} from "element-plus";
import {DockviewVue} from "dockview-vue";

// The existing component factories share one installed Vue runtime.
export async function loadStudioUiRuntime() {
  return {Vue, Pinia, ElementPlus: Object.assign(ElementPlus, {ElMessageBox}), DockviewVue};
}

export type StudioUiRuntime = Awaited<ReturnType<typeof loadStudioUiRuntime>>;
