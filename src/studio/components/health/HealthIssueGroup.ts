import type {CommandRegistry} from "../../commands/CommandRegistry";
import type {HealthFinding, HealthFindingsQuery, HealthFindingsReader} from "../../services/HealthFindings";
import type {DiagnosticResourceTarget} from "../../services/diagnosticObjectIds";

interface IssueGroupProps {
  domain: "scene" | "data";
  modelId: string;
  group: {code: string; label: string; description: string; severity: string; count: number};
  reader: HealthFindingsReader;
  query: HealthFindingsQuery;
  revision: number;
  cleanup: boolean;
}

export function createHealthIssueGroup(Vue: any) {
  return {
    name: "StudioHealthIssueGroup",
    props: ["domain", "modelId", "group", "reader", "query", "revision", "cleanup"],
    setup(props: IssueGroupProps) {
      const commands = Vue.inject("commands") as CommandRegistry;
      const expanded = Vue.ref(false);
      const page = Vue.ref(1);
      const body = Vue.ref(null);
      Vue.watch(() => [props.revision, props.query.search, props.query.severity], () => {page.value = 1;}, {flush: "sync"});
      const findings = Vue.computed(() => {
        void props.revision;
        return expanded.value ? props.reader.queryFindings({...props.query, code: props.group.code, page: page.value}) : null;
      });
      const target = (issue: HealthFinding): DiagnosticResourceTarget => ({
        domain: props.domain, modelId: props.modelId, resourceId: issue.resourceId, resourceKind: issue.resourceKind
      });
      const changePage = (value: number) => {
        page.value = value;
        // Keep focus inside this panel without scrolling Dockview's workspace.
        Vue.nextTick(() => {
          const element = body.value as HTMLElement | null;
          const scroller = element?.closest<HTMLElement>(".health-scroll");
          if (element && scroller) {
            scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          }
          element?.focus({preventScroll: true});
        });
      };
      const cleanupCommand = `${props.domain}Health.cleanupCodes`;
      return {commands, expanded, findings, body, changePage, target, cleanupCommand};
    },
    template: `
      <details class="health-issue-group" :data-severity="group.severity"
        @toggle="expanded = $event.target.open">
        <summary>
          <span class="health-issue-title">{{ group.label }}</span>
          <span class="health-severity">{{ group.severity }}</span>
          <strong class="health-issue-count">{{ group.count }}</strong>
        </summary>
        <div v-if="expanded && findings" class="health-issue-body" ref="body" tabindex="-1">
          <code class="health-issue-code">{{ group.code }}</code>
          <p>{{ group.description }}</p>
          <el-button v-if="cleanup" size="small" class="health-review-category"
            :disabled="!commands.isEnabled(cleanupCommand, [group.code])"
            @click="commands.execute(cleanupCommand, [group.code])">Apply category cleanup...</el-button>
          <ul class="health-findings">
            <li v-for="(issue, index) in findings.rows" :key="findings.page + ':' + index">
              <div class="health-finding-resource" v-if="issue.resourceId">
                <span v-if="issue.resourceKind">{{ issue.resourceKind }}</span>
                <code>{{ issue.resourceName || issue.resourceId }}</code>
              </div>
              <p>{{ issue.summary || issue.message }}</p>
              <details v-if="issue.summary && issue.message !== issue.summary" class="health-finding-message">
                <summary>Details</summary><p>{{ issue.message }}</p>
              </details>
              <el-button v-if="commands.isEnabled('diagnostics.frameResource', target(issue))" size="small"
                @click="commands.execute('diagnostics.frameResource', target(issue))">Fit in View</el-button>
            </li>
          </ul>
          <footer class="health-finding-pages">
            <span>{{ findings.total ? (findings.page - 1) * findings.pageSize + 1 : 0 }}–{{ Math.min(findings.page * findings.pageSize, findings.total) }} of {{ findings.total }}</span>
            <el-pagination v-if="findings.total > findings.pageSize" small layout="prev, next"
              :total="findings.total" :page-size="findings.pageSize" :current-page="findings.page"
              @current-change="changePage" />
          </footer>
        </div>
      </details>
    `
  };
}
