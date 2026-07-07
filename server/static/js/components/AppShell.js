import Sidebar from "./Sidebar.js?v=20260707-7";
import TopBar from "./TopBar.js?v=20260707-7";
import TaskComposer from "./TaskComposer.js?v=20260707-7";
import TaskQueue from "./TaskQueue.js?v=20260707-7";
import TaskInspector from "./TaskInspector.js?v=20260707-7";
import SourcesView from "./SourcesView.js?v=20260707-7";
import LibraryView from "./LibraryView.js?v=20260707-8";
import SettingsView from "./SettingsView.js?v=20260707-7";

export default {
  name: "AppShell",
  components: {
    Sidebar,
    TopBar,
    TaskComposer,
    TaskQueue,
    TaskInspector,
    SourcesView,
    LibraryView,
    SettingsView,
  },
  props: {
    state: { type: Object, required: true },
  },
  emits: [
    "refresh",
    "parse-url",
    "create-download",
    "create-batch",
    "create-live",
    "select-job",
    "cancel-job",
    "clear-done",
    "refresh-archive",
    "save-settings",
    "login",
    "clear-cookies",
    "sync-following",
    "sync-collections",
    "resolve-author",
    "open-author-works",
    "open-collection-works",
    "close-works",
    "load-more-works",
    "set-work-mode",
    "toggle-work",
    "toggle-following",
    "download-selected-works",
    "download-work",
    "download-user",
    "download-selected-following",
    "download-collection",
    "change-view",
    "open-archive-detail",
    "archive-filter-changed",
    "open-job-archive",
  ],
  computed: {
    pageMeta() {
      return (
        {
          workbench: { title: "工作台", subtitle: "下载、批量与直播" },
          sources: { title: "内容源", subtitle: "关注、收藏、作者" },
          library: { title: "本地库", subtitle: "下载记录" },
          settings: { title: "设置", subtitle: "偏好" },
        }[this.state.currentView] || { title: "工作台", subtitle: "下载、批量与直播" }
      );
    },
    selectedJob() {
      return this.state.jobs.find((job) => job.job_id === this.state.selectedJobId) || this.state.jobs[0] || null;
    },
  },
  template: `
    <div class="app-shell">
      <Sidebar
        :current-view="state.currentView"
        :account="state.account"
        @change-view="$emit('change-view', $event)"
      />
      <main class="main">
        <TopBar
          :title="pageMeta.title"
          :subtitle="pageMeta.subtitle"
          :health="state.health"
          :account="state.account"
          @refresh="$emit('refresh')"
        />

        <section v-if="state.currentView === 'workbench'" class="workspace-grid">
          <div class="workbench-stack">
            <TaskComposer
              :state="state"
              @parse-url="$emit('parse-url')"
              @create-download="$emit('create-download')"
              @create-batch="$emit('create-batch')"
              @create-live="$emit('create-live')"
            />
            <TaskInspector :job="selectedJob" @cancel-job="$emit('cancel-job', $event)" />
          </div>
          <div class="queue-stack">
            <TaskQueue
              :jobs="state.jobs"
              :selected-job-id="state.selectedJobId"
              @select-job="$emit('select-job', $event)"
              @clear-done="$emit('clear-done')"
              @open-job-archive="$emit('open-job-archive', $event)"
            />
          </div>
        </section>

        <SourcesView
          v-else-if="state.currentView === 'sources'"
          :sources="state.sources"
          @sync-following="$emit('sync-following')"
          @sync-collections="$emit('sync-collections')"
          @resolve-author="$emit('resolve-author')"
          @open-author-works="$emit('open-author-works', $event)"
          @open-collection-works="$emit('open-collection-works', $event)"
          @close-works="$emit('close-works')"
          @load-more-works="$emit('load-more-works')"
          @set-work-mode="$emit('set-work-mode', $event)"
          @toggle-work="$emit('toggle-work', $event)"
          @toggle-following="$emit('toggle-following', $event)"
          @download-selected-works="$emit('download-selected-works')"
          @download-work="$emit('download-work', $event)"
          @download-user="$emit('download-user', $event)"
          @download-selected-following="$emit('download-selected-following')"
          @download-collection="$emit('download-collection', $event)"
        />

        <LibraryView
          v-else-if="state.currentView === 'library'"
          :archive="state.archive"
          :authors="state.archiveAuthors"
          :filters="state.archiveFilters"
          :detail="state.library.detail"
          @refresh-archive="$emit('refresh-archive')"
          @filter-changed="$emit('archive-filter-changed')"
          @open-detail="$emit('open-archive-detail', $event)"
        />

        <SettingsView
          v-else
          :form="state.forms.settings"
          :config="state.config"
          :account="state.account"
          @save-settings="$emit('save-settings')"
          @login="$emit('login')"
          @clear-cookies="$emit('clear-cookies')"
        />
      </main>
    </div>
  `,
};
