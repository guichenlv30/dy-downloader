import { extractContentId, formatTime, progressData, statusText } from "../api.js";

export default {
  name: "TaskQueue",
  props: {
    jobs: { type: Array, required: true },
    selectedJobId: { type: String, default: "" },
  },
  emits: ["select-job", "clear-done", "open-job-archive"],
  methods: {
    formatTime,
    progressData,
    statusText,
    extractContentId,
    compactTitle(job) {
      if (job.overrides?.live) return "直播录制";
      if (/live\.douyin\.com|webcast\.amemv\.com|\/follow\/live\//.test(job.url || "")) return "直播录制";
      if (/\/music\//.test(job.url || "")) return "音乐下载";
      if (/\/user\//.test(job.url || "")) return "作者下载";
      return "作品下载";
    },
    humanSubtitle(job) {
      if (job.author_nickname) return `作者：${job.author_nickname}`;
      if (job.detail) return job.detail;
      const contentId = extractContentId(job.url);
      if (contentId) return `内容编号：${contentId}`;
      return job.url || "等待任务信息";
    },
    createdText(job) {
      return `创建于 ${formatTime(job.created_at)}`;
    },
  },
  computed: {
    sortedJobs() {
      return [...this.jobs].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    },
    counts() {
      return {
        total: this.jobs.length,
        running: this.jobs.filter((job) => ["pending", "running"].includes(job.status)).length,
        done: this.jobs.filter((job) => job.status === "success").length,
        failed: this.jobs.filter((job) => job.status === "failed").length,
      };
    },
  },
  template: `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">任务队列</h2>
          <div class="caption">
            全部 {{ counts.total }} · 运行 {{ counts.running }} · 完成 {{ counts.done }} · 失败 {{ counts.failed }}
          </div>
        </div>
        <button class="btn btn-ghost" type="button" @click="$emit('clear-done')">清理完成</button>
      </div>
      <div class="card-body">
        <div v-if="!sortedJobs.length" class="empty">暂无任务</div>
        <div v-else class="task-list">
          <article
            v-for="job in sortedJobs"
            :key="job.job_id"
            class="task-row"
            :class="{ active: selectedJobId === job.job_id }"
            @click="$emit('select-job', job.job_id)"
            @dblclick="$emit('open-job-archive', job)"
            title="双击跳转本地库记录"
          >
            <div class="row" style="justify-content: space-between;">
              <div class="task-title">{{ compactTitle(job) }}</div>
              <span class="status-badge">{{ statusText(job.status) }}</span>
            </div>
            <div class="task-subtitle">{{ humanSubtitle(job) }}</div>
            <div class="caption">{{ createdText(job) }}</div>
            <div class="progress">
              <div class="progress-bar" :style="{ width: progressData(job).value + '%' }"></div>
            </div>
            <div class="meta-row">
              <span class="badge">进度 {{ progressData(job).label }}</span>
              <span class="badge">成功 {{ Number(job.success || 0) }}</span>
              <span class="badge">失败 {{ Number(job.failed || 0) }}</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  `,
};
