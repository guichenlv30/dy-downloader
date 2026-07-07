export default {
  name: "TopBar",
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    health: { type: Object, required: true },
    account: { type: Object, required: true },
  },
  emits: ["refresh"],
  template: `
    <header class="topbar">
      <div>
        <div class="eyebrow">{{ subtitle }}</div>
        <h1 class="page-title">{{ title }}</h1>
      </div>
      <div class="topbar-actions">
        <span class="status-badge">
          <span class="dot" :class="{ ok: health.ok, bad: !health.ok }"></span>
          {{ health.label }}
        </span>
        <span class="status-badge">
          <span class="dot" :class="{ ok: account.ok, bad: !account.ok }"></span>
          <span>{{ account.profile?.nickname || account.label }}</span>
          <small v-if="account.detail">{{ account.detail }}</small>
        </span>
        <button class="btn btn-ghost" type="button" @click="$emit('refresh')">刷新</button>
      </div>
    </header>
  `,
};
