import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {ExplorerSource} from "../../explorers/types";
import type {ExplorerSearchResult} from "../../explorers/searchTreeEntries";
import {EXPLORER_SEARCH_LIMIT} from "../../explorers/searchTreeEntries";
import type {ExplorerNavigationService} from "../../services/ExplorerNavigationService";
import {REVEAL_DESTINATIONS} from "../../explorers/revealDestinations";
import type {TreeSearchEntry} from "../../explorers/tree/treeSearchEntries";
import type {ExplorerSessions} from "../../explorers/ExplorerSessions";

export function createExplorerSearch(Vue: any, source: ExplorerSource) {
  return {
    name: "StudioExplorerSearch",
    emits: ["active"],
    setup(_props: unknown, {emit}: {emit: (name: string, value: boolean) => void}) {
      const navigation = Vue.inject("explorerNavigation") as ExplorerNavigationService;
      const commands = Vue.inject("commands") as CommandRegistry;
      const sessions = Vue.inject("explorerSessions") as ExplorerSessions;
      const search = Vue.reactive(sessions.get(source).search);
      const {query, browsing, limit} = Vue.toRefs(search);
      const results = Vue.ref({entries: [], total: 0} as ExplorerSearchResult);
      const ready = Vue.ref(false);
      const busy = Vue.ref(false);
      const error = Vue.ref("");
      const list = Vue.ref(null as HTMLElement | null);
      const showingResults = Vue.computed(() => !!query.value.trim() && !browsing.value);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: AbortController | null = null;
      let disposed = false;
      const clear = () => { query.value = ""; };
      Vue.watch(query, () => { browsing.value = false; limit.value = EXPLORER_SEARCH_LIMIT; search.scrollTop = 0; });
      Vue.watch(showingResults, (active: boolean) => emit("active", active), {immediate: true});
      Vue.watch(() => [showingResults.value, results.value], async () => {
        await Vue.nextTick();
        if (list.value && showingResults.value) list.value.scrollTop = search.scrollTop;
      }, {flush: "post"});
      const unsubscribe = commands.onDidExecute((event) => {
        if (event.status === "started" && REVEAL_DESTINATIONS.some((item) => item.source === source && item.commandId === event.commandId)) clear();
      });
      Vue.onMounted(async () => {
        await navigation.whenMounted(source);
        if (!disposed) ready.value = true;
      });
      Vue.watch(() => [query.value, ready.value, navigation.revision(source), limit.value], () => {
        clearTimeout(timer);
        abort?.abort();
        error.value = "";
        busy.value = !!query.value.trim();
        if (!query.value.trim() || !ready.value) { results.value = {entries: [], total: 0}; return; }
        const request = new AbortController();
        abort = request;
        timer = setTimeout(async () => {
          try {
            const next = await navigation.search(source, query.value, request.signal, limit.value);
            if (!request.signal.aborted) results.value = next;
          } catch (reason) {
            if (!request.signal.aborted) error.value = reason instanceof Error ? reason.message : String(reason);
          } finally {
            if (!request.signal.aborted) busy.value = false;
          }
        }, 150);
      });
      Vue.onUnmounted(() => { disposed = true; clearTimeout(timer); abort?.abort(); unsubscribe(); });
      const reveal = async (entry: TreeSearchEntry) => {
        browsing.value = true;
        await Vue.nextTick();
        commands.execute("explorer.revealResult", {source, entry});
      };
      return {query, results, busy, error, list, reveal, clear, browsing, showingResults,
        rememberScroll: (event: Event) => { search.scrollTop = (event.target as HTMLElement).scrollTop; },
        loadMore: () => { limit.value += EXPLORER_SEARCH_LIMIT; },
        focusResults: () => (list.value as HTMLElement | null)?.querySelector<HTMLButtonElement>("button")?.focus()};
    },
    template: `
      <div class="explorer-search" :data-active="showingResults ? 'true' : 'false'" @keydown.esc.stop="clear">
        <div class="explorer-search-field">
          <el-input v-model="query" clearable size="small" aria-label="Search explorer by name, ID or type"
            placeholder="Search name, ID, type..." @keydown.down.prevent="focusResults" />
        </div>
        <button v-if="query.trim() && browsing" type="button" class="explorer-search-return" @click="browsing = false">Back to results ({{ results.total }})</button>
        <template v-if="showingResults">
          <p class="explorer-search-status" role="status">{{ busy ? 'Searching...' : error || (results.total ? results.entries.length + ' of ' + results.total + ' matches' : 'No matching items.') }}</p>
          <ul ref="list" class="explorer-search-results" :aria-busy="busy" :inert="busy" @scroll.passive="rememberScroll">
            <li v-for="entry in results.entries" :key="entry.path.join('/')">
              <button type="button" :title="entry.type + ': ' + entry.id" @click="reveal(entry)">
                <span class="explorer-search-type">{{ entry.type }}</span>
                <strong>{{ entry.title }}</strong>
                <code v-if="entry.title !== entry.id">{{ entry.id }}</code>
                <span v-if="entry.context" class="explorer-search-context">{{ entry.context }}</span>
              </button>
            </li>
          </ul>
          <button v-if="results.entries.length < results.total" class="explorer-search-more" :disabled="busy" @click="loadMore">Load more results</button>
        </template>
      </div>`
  };
}
