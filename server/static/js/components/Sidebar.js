export default {
  name: "Sidebar",
  props: {
    currentView: { type: String, required: true },
    account: { type: Object, required: true },
  },
  emits: ["change-view"],
  data() {
    return {
      items: [
        { key: "workbench", label: "工作台", icon: "⌁" },
        { key: "sources", label: "内容源", icon: "◎" },
        { key: "library", label: "本地库", icon: "▤" },
        { key: "settings", label: "设置", icon: "⚙" },
      ],
    };
  },
  template: `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">D</div>
        <div>
          <div class="brand-title">Douzy</div>
          <div class="brand-subtitle">Douyin Downloader</div>
        </div>
      </div>

      <button class="account-card" type="button" @click="$emit('change-view', 'settings')">
        <span class="avatar small">
          <img v-if="account.profile?.avatar" :src="account.profile.avatar" alt="" referrerpolicy="no-referrer" />
          <span v-else>{{ account.profile?.nickname ? account.profile.nickname.slice(0, 1) : '抖' }}</span>
        </span>
        <span class="account-copy">
          <strong>{{ account.profile?.nickname || '抖音账号' }}</strong>
          <small>{{ account.detail || account.label }}</small>
        </span>
        <span class="dot" :class="{ ok: account.ok, bad: !account.ok && !account.verifying }"></span>
      </button>

      <nav class="sidebar-nav" aria-label="主导航">
        <button
          v-for="item in items"
          :key="item.key"
          class="nav-button"
          :class="{ active: currentView === item.key }"
          type="button"
          @click="$emit('change-view', item.key)"
        >
          <span>{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="badge"><span class="dot ok"></span><span>Douzy 已启用</span></div>
        <div class="caption">Vue 静态前端 · 可回退</div>
      </div>
    </aside>
  `,
};
