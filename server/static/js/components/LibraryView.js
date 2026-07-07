import { formatTime, typeClass, typeText } from "../api.js";

export default {
  name: "LibraryView",
  props: {
    archive: { type: Object, required: true },
    authors: { type: Object, required: true },
    filters: { type: Object, required: true },
    detail: { type: Object, default: null },
  },
  emits: ["refresh-archive", "filter-changed", "open-detail"],
  data() {
    return {
      debounceTimer: null,
      typeTabs: [
        { key: "", label: "全部" },
        { key: "video", label: "视频" },
        { key: "gallery", label: "图文" },
        { key: "music", label: "音乐" },
        { key: "live", label: "直播" },
      ],
    };
  },
  computed: {
    authorOptions() {
      const seen = new Set();
      const options = (this.authors.items || [])
        .filter((item) => item?.author_name)
        .filter((item) => {
          const key = String(item.author_name);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (this.filters.author && !seen.has(String(this.filters.author))) {
        options.unshift({ author_name: this.filters.author, download_count: 0 });
      }
      return options;
    },
  },
  methods: {
    formatTime,
    typeClass,
    typeText,
    scheduleRefresh() {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => this.$emit("filter-changed"), 260);
    },
    setType(type) {
      this.filters.aweme_type = type;
      this.$emit("filter-changed");
    },
    setAuthor(authorName) {
      this.filters.author = authorName;
      this.$emit("filter-changed");
    },
    detailKey(item) {
      return item?.aweme_id || item?.file_path || item?.copy_path || "";
    },
    isDetailItem(item) {
      return Boolean(this.detail && this.detailKey(this.detail) && this.detailKey(this.detail) === this.detailKey(item));
    },
    closeDetail() {
      this.$emit("open-detail", null);
    },
    copyPath(path) {
      if (path) navigator.clipboard?.writeText(path).catch(() => {});
    },
  },
  template: `
    <section class="stack">
      <section class="card library-panel">
        <div class="card-header">
          <div>
            <h2 class="card-title">本地库</h2>
            <div class="caption">{{ archive.total || 0 }} 条本地记录</div>
          </div>
          <button class="btn btn-secondary" type="button" @click="$emit('refresh-archive')">刷新记录</button>
        </div>
        <div class="card-body stack">
          <div class="field-grid">
            <div class="author-picker">
              <input
                class="input"
                v-model="filters.author"
                list="archive-author-options"
                placeholder="作者 / 可直接输入"
                @input="scheduleRefresh"
              />
              <datalist id="archive-author-options">
                <option
                  v-for="author in authorOptions"
                  :key="author.author_sec_uid || author.author_id || author.author_name"
                  :value="author.author_name"
                >
                  {{ author.author_name }}（{{ Number(author.download_count || 0) }}）
                </option>
              </datalist>
              <select class="select" :value="filters.author" @change="setAuthor($event.target.value)">
                <option value="">全部作者</option>
                <option
                  v-for="author in authorOptions"
                  :key="author.author_sec_uid || author.author_id || author.author_name"
                  :value="author.author_name"
                >
                  {{ author.author_name }}（{{ Number(author.download_count || 0) }}）
                </option>
              </select>
            </div>
            <input class="input" v-model="filters.title" placeholder="标题" @input="scheduleRefresh" />
          </div>
          <div class="type-filter-row">
            <button
              v-for="tab in typeTabs"
              :key="tab.key || 'all'"
              class="type-chip"
              :class="[tab.key ? typeClass(tab.key) : 'type-all', { active: filters.aweme_type === tab.key }]"
              type="button"
              @click="setType(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
          <div v-if="!archive.items.length" class="empty archive-results">暂无下载记录</div>
          <div v-else class="task-list archive-results">
            <article
              v-for="item in archive.items"
              :key="item.aweme_id"
              class="task-row archive-row"
              :class="[typeClass(item.aweme_type), { 'has-detail': isDetailItem(item) }]"
              title="双击查看文件详情"
              @dblclick="$emit('open-detail', item)"
            >
              <div class="row" style="justify-content: space-between;">
                <div class="task-title">{{ item.title || '未命名内容' }}</div>
                <span class="badge type-badge" :class="typeClass(item.aweme_type)">{{ typeText(item.aweme_type) }}</span>
              </div>
              <div class="task-subtitle">{{ item.author_name || '未知作者' }} · {{ formatTime(item.download_time) }}</div>
              <div class="caption">{{ item.copy_path || item.file_path }}</div>
              <section v-if="isDetailItem(item)" class="library-detail embedded-detail" @dblclick.stop>
                <div class="row" style="justify-content: space-between;">
                  <div>
                    <h3 class="card-title">文件详情</h3>
                    <div class="caption">路径可直接复制。</div>
                  </div>
                  <div class="button-row">
                    <span class="badge type-badge" :class="typeClass(detail.aweme_type)">{{ typeText(detail.aweme_type) }}</span>
                    <button class="btn btn-ghost" type="button" @click.stop="closeDetail">关闭</button>
                  </div>
                </div>
                <div class="detail-grid">
                  <div><strong>标题</strong><span>{{ detail.title || '未命名内容' }}</span></div>
                  <div><strong>作者</strong><span>{{ detail.author_name || '未知作者' }}</span></div>
                  <div><strong>下载时间</strong><span>{{ formatTime(detail.download_time) }}</span></div>
                  <div><strong>作品 ID</strong><span>{{ detail.aweme_id }}</span></div>
                </div>
                <div class="path-box">
                  <span>{{ detail.copy_path || detail.file_path }}</span>
                  <button class="btn btn-secondary" type="button" @click.stop="copyPath(detail.copy_path || detail.file_path)">复制路径</button>
                </div>
              </section>
            </article>
          </div>
        </div>
      </section>
    </section>
  `,
};
