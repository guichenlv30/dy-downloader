import { formatTime, progressData, statusText } from "../api.js";

export default {
  name: "TaskInspector",
  props: {
    job: { type: Object, default: null },
  },
  emits: ["cancel-job"],
  methods: {
    formatTime,
    progressData,
    statusText,
  },
  computed: {
    canCancel() {
      return this.job && ["pending", "running"].includes(this.job.status);
    },
    logs() {
      if (!this.job) return [];
      const items = [
        { label: "创建任务", value: this.formatTime(this.job.created_at) },
        this.job.started_at ? { label: "开始执行", value: this.formatTime(this.job.started_at) } : null,
        this.job.step ? { label: this.job.step, value: this.job.detail || "处理中" } : null,
        this.job.error ? { label: "错误", value: this.job.error } : null,
        this.job.finished_at ? { label: "结束", value: this.formatTime(this.job.finished_at) } : null,
      ].filter(Boolean);
      return items;
    },
  },
  template: `
    <section class="card inspector-card">
      <div class="card-header">
        <div>
          <h2 class="card-title">任务详情</h2>
          <div class="caption">{{ job ? job.job_id : "未选择任务" }}</div>
        </div>
        <button class="btn btn-danger" type="button" :disabled="!canCancel" @click="$emit('cancel-job', job.job_id)">
          停止
        </button>
      </div>
      <div class="card-body">
        <div v-if="!job" class="empty">点击左侧任务查看详情</div>
        <div v-else class="stack">
          <div class="inspector-fixed">
            <div>
            <div class="task-title">{{ job.url }}</div>
            <div class="task-subtitle">{{ statusText(job.status) }} · {{ job.step || "等待状态更新" }}</div>
          </div>
          <div class="progress"><div class="progress-bar" :style="{ width: progressData(job).value + '%' }"></div></div>
          <div class="field-grid">
            <div class="badge">总数 {{ Number(job.total || 0) }}</div>
            <div class="badge">成功 {{ Number(job.success || 0) }}</div>
            <div class="badge">失败 {{ Number(job.failed || 0) }}</div>
            <div class="badge">跳过 {{ Number(job.skipped || 0) }}</div>
          </div>
          </div>
          <ul class="inspector-log">
            <li v-for="item in logs" :key="item.label + item.value">
              <strong>{{ item.label }}</strong>
              <div class="caption">{{ item.value }}</div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  `,
};
