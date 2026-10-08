import {Bookmark, Pencil, Trash2, Check, X, Plus} from "lucide-vue-next";

export function createSavedViewsDialog(Vue: any) {
  return {
    name: "SavedViewsDialog",
    components: {Bookmark, Pencil, Trash2, Check, X, Plus},
    setup() {
      const workspace = Vue.inject("workspace"), commands = Vue.inject("commands"), state = workspace.savedViews;
      const name = Vue.ref(""), editId = Vue.ref(""), editName = Vue.ref(""), form = Vue.ref(null);
      let returnFocus: HTMLElement | null = null;
      const suggestName = () => {
        const floor = workspace.section.planFloorTitle;
        const exists = (name: string) => state.items.some((item: any) => item.name === name);
        let n = 1;
        const candidate = () => floor ? (n === 1 ? floor : `${floor} (${n})`) : `View ${n}`;
        while (exists(candidate())) n++;
        name.value = candidate();
      };
      Vue.watch(() => state.open, (open: boolean) => {if (open) returnFocus = document.activeElement as HTMLElement;});
      Vue.watch(() => [state.open, state.modelKey], () => {if (state.open) {editId.value = ""; suggestName();}});
      const run = (id: string, payload?: unknown) => commands.execute(id, payload);
      const edit = async (item: any) => {
        editId.value = item.id; editName.value = item.name;
        await Vue.nextTick(); form.value?.querySelector('.saved-view-rename input')?.select();
      };
      const finishEdit = () => {
        run('views.rename', {id: editId.value, name: editName.value});
        if (!state.error) {const id = editId.value; editId.value = ""; Vue.nextTick(() => form.value?.querySelector(`[data-view-id="${id}"] .saved-view-open`)?.focus());}
      };
      const remove = async (id: string) => {
        run('views.delete', id);
        await Vue.nextTick(); form.value?.querySelector('.saved-view-undo')?.focus();
      };
      const undo = async () => {
        run('views.undoDelete'); await Vue.nextTick(); form.value?.querySelector('.saved-view-open')?.focus();
      };
      const focusInitial = () => {
        if (state.items.length) form.value?.querySelector('.saved-view-open')?.focus();
        else form.value?.querySelector('.saved-view-create input')?.select();
      };
      const restoreFocus = () => {
        editId.value = "";
        const target = returnFocus?.isConnected && returnFocus !== document.body && returnFocus.getClientRects().length ? returnFocus
          : document.querySelector<HTMLElement>('button[aria-label="More model tools"]');
        target?.focus({preventScroll: true});
      };
      return {workspace, state, name, editId, editName, form, run, edit, finishEdit, remove, undo, focusInitial, restoreFocus};
    },
    template: `<el-dialog v-model="state.open" title="Saved views" class="saved-views-dialog" width="560px"
      :append-to-body="true" @opened="focusInitial" @closed="restoreFocus">
      <div ref="form" class="saved-views-content" :aria-busy="state.busy">
        <p class="saved-views-hint">Save a camera position, floor plan, cuts, and element visibility. Views stay in this browser for the same loaded models.</p>
        <form class="saved-view-create" @submit.prevent="run('views.save', name)">
          <label for="saved-view-name">View name</label>
          <div><input id="saved-view-name" v-model="name" maxlength="100" autocomplete="off" placeholder="e.g. Level 2 stair clearance"
            :disabled="state.busy || !state.modelKey"/>
            <button type="submit" class="saved-view-save" :disabled="state.busy || !state.modelKey || !name.trim()"><Plus/>{{ state.busy ? 'Saving…' : 'Save view' }}</button></div>
        </form>
        <p v-if="state.error" class="saved-views-error" role="alert">{{ state.error }}</p>
        <div v-if="state.notice" class="saved-views-notice" role="status"><span>{{ state.notice }}</span>
          <button v-if="state.undoName" type="button" class="saved-view-undo" :disabled="state.busy" @click="undo">Undo delete</button></div>
        <ul v-if="state.items.length" class="saved-views-list" aria-label="Saved views">
          <li v-for="item in state.items" :key="item.id" :data-view-id="item.id">
            <form v-if="editId === item.id" class="saved-view-rename" @submit.prevent="finishEdit" @keydown.esc.stop.prevent="editId = ''">
              <input v-model="editName" aria-label="New view name" maxlength="100" autocomplete="off"/>
              <button type="submit" aria-label="Save view name" title="Save view name" :disabled="!editName.trim()"><Check/></button>
              <button type="button" aria-label="Cancel rename" title="Cancel rename" @click="editId = ''"><X/></button>
            </form>
            <template v-else>
              <button type="button" class="saved-view-open" :aria-label="'Open ' + item.name" :disabled="state.busy" @click="run('views.restore', item.id)">
                <img v-if="item.thumbnail" :src="item.thumbnail" alt="" width="80" height="50"/>
                <span v-else class="saved-view-placeholder"><Bookmark/></span>
                <span class="saved-view-description"><strong :title="item.name">{{ item.name }}</strong><small>{{ item.floorTitle ? 'Plan · ' + item.floorTitle : '3D view' }}</small></span>
              </button>
              <button type="button" class="saved-view-action" :aria-label="'Rename ' + item.name" title="Rename view" :disabled="state.busy" @click="edit(item)"><Pencil/></button>
              <button type="button" class="saved-view-action" :aria-label="'Delete ' + item.name" title="Delete view" :disabled="state.busy" @click="remove(item.id)"><Trash2/></button>
            </template>
          </li>
        </ul>
        <p v-else-if="!state.error" class="saved-views-empty">{{ state.modelKey ? 'No saved views yet. Frame an area, then give it a name above.' : 'Load a model to save and open its views.' }}</p>
      </div>
      <template #footer><el-button @click="state.open = false">Done</el-button></template>
    </el-dialog>`
  };
}
