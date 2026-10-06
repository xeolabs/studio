export function createHealthCleanupHistory() {
  return {
    name: "StudioHealthCleanupHistory",
    props: ["history"],
    template: `
      <details v-if="history.length" class="health-model-details health-cleanup-history">
        <summary>Cleanup history <span>{{ history.length }}</span></summary>
        <article v-for="run in history" :key="run.timestamp">
          <strong>{{ run.label }}</strong>
          <time :datetime="run.timestamp">{{ new Date(run.timestamp).toLocaleString() }}</time>
          <p>{{ run.fixed }} fixed · {{ run.skipped }} skipped · {{ run.errors }} errors</p>
          <code>{{ run.codes.join(', ') }}</code>
          <p v-if="run.errorMessage" role="alert">{{ run.errorMessage }}</p>
        </article>
      </details>
    `
  };
}
