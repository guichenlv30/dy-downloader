import { downloadStateText, formatDate, formatNumber, typeText } from "../api.js";

const WORK_MODES = [
  { key: "post", label: "作品", note: "公开作品" },
  { key: "like", label: "喜欢", note: "作者喜欢列表" },
  { key: "mix", label: "合集", note: "作者合集" },
  { key: "music", label: "音乐", note: "作者音乐作品" },
];

export default {
  name: "SourcesView",
  props: {
    sources: { type: Object, required: true },
  },
  emits: [
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
  ],
  data() {
    return {
      sections: [
        { key: "following", label: "我的关注" },
        { key: "collections", label: "我的收藏" },
        { key: "author", label: "作者主页" },
      ],
      workModes: WORK_MODES,
    };
  },
  computed: {
    following() {
      return this.sources.following;
    },
    collections() {
      return this.sources.collections;
    },
    author() {
      return this.sources.author;
    },
    works() {
      return this.sources.works;
    },
    filteredFollowing() {
      const query = this.following.query.trim().toLowerCase();
      const items = this.following.items.filter((item) => {
        const text = `${item.nickname || ""} ${item.signature || ""} ${item.sec_uid || ""}`.toLowerCase();
        return !query || text.includes(query);
      });
      return items.sort((a, b) => {
        if (this.following.sort === "aweme") return Number(b.aweme_count || 0) - Number(a.aweme_count || 0);
        if (this.following.sort === "fans") return Number(b.follower_count || 0) - Number(a.follower_count || 0);
        return String(a.nickname || "").localeCompare(String(b.nickname || ""), "zh-Hans-CN");
      });
    },
    collectionItems() {
      const folders = (this.collections.folders || []).map((item) => ({ ...item, type: "folder" }));
      const mixes = (this.collections.mixes || []).map((item) => ({ ...item, type: "mix" }));
      const query = this.collections.query.trim().toLowerCase();
      return [...folders, ...mixes].filter((item) => {
        const typeOk = this.collections.filter === "all" || item.type === this.collections.filter;
        const text = `${item.title || ""} ${item.id || ""}`.toLowerCase();
        return typeOk && (!query || text.includes(query));
      });
    },
    filteredWorks() {
      const query = this.works.query.trim().toLowerCase();
      const items = this.works.items.filter((item) => {
        const text = `${item.title || ""} ${item.desc || ""} ${item.id || ""}`.toLowerCase();
        return (!query || text.includes(query)) && (!this.works.type || item.type === this.works.type);
      });
      return items.sort((a, b) => {
        if (this.works.sort === "digg") return Number(b.stats?.digg || 0) - Number(a.stats?.digg || 0);
        if (this.works.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
        return Number(b.create_time || 0) - Number(a.create_time || 0);
      });
    },
  },
  methods: {
    formatDate,
    formatNumber,
    typeText,
    downloadStateText,
    avatarText(item) {
      return String(item?.nickname || item?.title || item?.id || "?").slice(0, 1);
    },
    collectionKey(item) {
      return `${item.type}:${item.id}`;
    },
    workKey(item) {
      return `${item.type}:${item.id}`;
    },
    isFollowingSelected(secUid) {
      return this.following.selected.includes(secUid);
    },
    isWorkSelected(item) {
      return this.works.selected.includes(this.workKey(item));
    },
    workMeta(item) {
      if (item.type === "video" || item.type === "gallery") {
        return `${this.formatDate(item.create_time)} · 赞 ${this.formatNumber(item.stats?.digg)}`;
      }
      return `数量 ${this.formatNumber(item.count)}`;
    },
  },
  template: `
    <section class="source-shell">
      <section v-if="!works.visible" class="card sources-panel">
        <div class="card-header">
          <div>
            <h2 class="card-title">内容源</h2>
            <div class="caption">从关注、收藏或作者主页进入预览，再选择要下载的内容。</div>
          </div>
          <div class="tabs">
            <button
              v-for="section in sections"
              :key="section.key"
              class="tab"
              :class="{ active: sources.section === section.key }"
              type="button"
              @click="sources.section = section.key"
            >
              {{ section.label }}
            </button>
          </div>
        </div>

        <div v-if="sources.section === 'following'" class="card-body stack">
          <div class="toolbar-grid">
            <input class="input" v-model="following.query" type="search" placeholder="搜索昵称 / 签名" />
            <select class="select" v-model="following.sort">
              <option value="nickname">按昵称</option>
              <option value="fans">按粉丝数</option>
              <option value="aweme">按作品数</option>
            </select>
            <select class="select" v-model="following.downloadMode">
              <option value="post">下载作品</option>
              <option value="like">下载喜欢</option>
              <option value="mix">下载合集</option>
              <option value="music">下载音乐</option>
            </select>
            <button class="btn btn-secondary" type="button" :disabled="following.syncing" @click="$emit('sync-following')">
              {{ following.syncing ? '同步中' : '同步关注' }}
            </button>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="!following.selected.length"
              @click="$emit('download-selected-following')"
            >
              下载选中
            </button>
          </div>
          <div class="caption">{{ following.items.length }} 个关注<span v-if="following.error"> · {{ following.error }}</span></div>
          <div v-if="!filteredFollowing.length" class="empty source-results">{{ following.syncing ? '正在同步关注' : '暂无关注数据' }}</div>
          <div v-else class="entity-list source-results" :class="{ grid: following.layout === 'grid' }">
            <article
              v-for="item in filteredFollowing"
              :key="item.sec_uid"
              class="entity-row"
              title="双击进入作品预览"
              @dblclick="$emit('open-author-works', { author: item, mode: 'post' })"
            >
              <label class="mini-check">
                <input type="checkbox" :checked="isFollowingSelected(item.sec_uid)" @change="$emit('toggle-following', item.sec_uid)" />
              </label>
              <button class="avatar avatar-button" type="button" @click="$emit('open-author-works', { author: item, mode: 'post' })">
                <img v-if="item.avatar" :src="item.avatar" alt="" referrerpolicy="no-referrer" />
                <span v-else>{{ avatarText(item) }}</span>
              </button>
              <div class="entity-main">
                <div class="entity-title">{{ item.nickname || '未命名账号' }}</div>
                <div class="entity-subtitle">{{ item.signature || item.sec_uid }}</div>
                <div class="meta-row">
                  <span class="badge">作品 {{ formatNumber(item.aweme_count) }}</span>
                  <span class="badge">粉丝 {{ formatNumber(item.follower_count) }}</span>
                  <span class="badge">关注 {{ formatNumber(item.following_count) }}</span>
                </div>
              </div>
              <div class="entity-actions">
                <button class="btn btn-secondary" type="button" @click="$emit('download-user', item.sec_uid)">下载</button>
              </div>
            </article>
          </div>
        </div>

        <div v-else-if="sources.section === 'collections'" class="card-body stack">
          <div class="toolbar-grid">
            <input class="input" v-model="collections.query" type="search" placeholder="搜索收藏夹 / 合集" />
            <select class="select" v-model="collections.filter">
              <option value="all">全部</option>
              <option value="folder">收藏夹</option>
              <option value="mix">收藏合集</option>
            </select>
            <button class="btn btn-secondary" type="button" :disabled="collections.syncing" @click="$emit('sync-collections')">
              {{ collections.syncing ? '同步中' : '同步收藏' }}
            </button>
          </div>
          <div class="caption">{{ collections.folders.length }} 个收藏夹，{{ collections.mixes.length }} 个收藏合集<span v-if="collections.error"> · {{ collections.error }}</span></div>
          <div v-if="!collectionItems.length" class="empty source-results">{{ collections.syncing ? '正在同步收藏' : '暂无收藏数据' }}</div>
          <div v-else class="entity-list source-results">
            <article
              v-for="item in collectionItems"
              :key="collectionKey(item)"
              class="entity-row"
              title="双击进入作品预览"
              @dblclick="$emit('open-collection-works', item)"
            >
              <button class="badge badge-button" type="button" @click="$emit('open-collection-works', item)">{{ typeText(item.type) }}</button>
              <button class="avatar avatar-button" type="button" @click="$emit('open-collection-works', item)">
                <img v-if="item.cover" :src="item.cover" alt="" referrerpolicy="no-referrer" />
                <span v-else>{{ typeText(item.type).slice(0, 2) }}</span>
              </button>
              <div class="entity-main">
                <div class="entity-title">{{ item.title || item.id }}</div>
                <div class="entity-subtitle">{{ item.id }}</div>
                <div class="meta-row"><span class="badge">数量 {{ formatNumber(item.count) }}</span></div>
              </div>
              <div class="entity-actions">
                <button class="btn btn-secondary" type="button" @click="$emit('download-collection', item)">下载</button>
              </div>
            </article>
          </div>
        </div>

        <div v-else class="card-body stack">
          <textarea v-model="author.url" class="textarea" placeholder="粘贴作者主页链接或分享主页文案"></textarea>
          <div class="button-row">
            <button class="btn btn-secondary" type="button" :disabled="author.resolving" @click="$emit('resolve-author')">
              {{ author.resolving ? '解析中' : '解析作者' }}
            </button>
          </div>
          <div v-if="author.error" class="status-badge">{{ author.error }}</div>
          <article v-if="author.profile" class="entity-row">
            <button class="avatar avatar-button" type="button" @click="$emit('open-author-works', { author: author.profile, mode: 'post' })">
              <img v-if="author.profile.avatar" :src="author.profile.avatar" alt="" referrerpolicy="no-referrer" />
              <span v-else>{{ avatarText(author.profile) }}</span>
            </button>
            <div class="entity-main">
              <div class="entity-title">{{ author.profile.nickname || author.profile.sec_uid }}</div>
              <div class="entity-subtitle">{{ author.profile.signature || author.profile.sec_uid }}</div>
            </div>
          </article>
          <div class="source-card-grid">
            <button
              v-for="mode in workModes"
              :key="mode.key"
              class="source-card"
              type="button"
              @click="$emit('open-author-works', { author: author.profile, mode: mode.key })"
            >
              <strong>{{ mode.label }}</strong>
              <span>{{ mode.note }}</span>
              <small>{{ author.profile ? '点击预览' : '先解析作者主页' }}</small>
            </button>
          </div>
        </div>
      </section>

      <section v-if="works.visible" class="card works-panel">
        <div class="card-header">
          <div>
            <h2 class="card-title">{{ works.title || '作品预览' }}</h2>
            <div class="caption">已载入 {{ works.items.length }} 个内容，已选 {{ works.selected.length }} 个</div>
          </div>
          <div class="button-row">
            <button class="btn btn-primary" type="button" :disabled="!works.selected.length" @click="$emit('download-selected-works')">下载选中</button>
            <button class="btn btn-ghost" type="button" @click="$emit('close-works')">关闭预览</button>
          </div>
        </div>
        <div class="card-body stack">
          <div class="toolbar-grid">
            <input class="input" v-model="works.query" type="search" placeholder="搜索标题" />
            <select class="select" v-model="works.type">
              <option value="">全部类型</option>
              <option value="video">视频</option>
              <option value="gallery">图文</option>
              <option value="mix">合集</option>
              <option value="music">音乐</option>
            </select>
            <select class="select" v-model="works.sort">
              <option value="new">最新发布</option>
              <option value="digg">按点赞</option>
              <option value="title">按标题</option>
            </select>
            <button class="btn btn-secondary" type="button" :disabled="works.loading || !works.hasMore" @click="$emit('load-more-works')">
              {{ works.loading ? '加载中' : '加载更多' }}
            </button>
          </div>
          <div v-if="works.source === 'author'" class="tabs">
            <button
              v-for="mode in workModes"
              :key="mode.key"
              class="tab"
              :class="{ active: works.mode === mode.key }"
              type="button"
              @click="$emit('set-work-mode', mode.key)"
            >
              {{ mode.label }}
            </button>
          </div>
          <div v-if="works.error" class="status-badge">{{ works.error }}</div>
          <div v-if="!filteredWorks.length" class="empty works-results">{{ works.loading ? '正在加载作品' : '暂无内容' }}</div>
          <div v-else class="work-grid works-results">
            <article v-for="item in filteredWorks" :key="workKey(item)" class="work-card" :class="{ selected: isWorkSelected(item) }">
              <label class="mini-check">
                <input type="checkbox" :checked="isWorkSelected(item)" @change="$emit('toggle-work', workKey(item))" />
              </label>
              <div class="work-cover">
                <img v-if="item.cover" :src="item.cover" alt="" referrerpolicy="no-referrer" />
                <span v-else>{{ typeText(item.type).slice(0, 2) }}</span>
              </div>
              <div class="work-title">{{ item.title || item.id }}</div>
              <div class="meta-row">
                <span class="badge">{{ typeText(item.type) }}</span>
                <span class="badge">{{ workMeta(item) }}</span>
                <span v-if="downloadStateText(item)" class="badge">{{ downloadStateText(item) }}</span>
              </div>
              <div class="button-row">
                <button class="btn btn-secondary" type="button" @click="$emit('download-work', item)">下载</button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </section>
  `,
};
