"use strict";

const API = "/api/v1";
const DOUYIN_URL_RE =
  /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|live\.douyin\.com|v\.iesdouyin\.com|webcast\.amemv\.com)\/[^\s，。；;、]+/i;
const GENERIC_URL_RE = /https?:\/\/[^\s，。；;、]+/i;
const DOUYIN_URL_GLOBAL_RE =
  /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|live\.douyin\.com|v\.iesdouyin\.com|webcast\.amemv\.com)\/[^\s，。；;、]+/gi;
const GENERIC_URL_GLOBAL_RE = /https?:\/\/[^\s，。；;、]+/gi;

const MODES = [
  { key: "post", title: "作品", icon: "▣", detail: "公开作品" },
  { key: "like", title: "喜欢", icon: "♡", detail: "喜欢列表" },
  { key: "mix", title: "合集", icon: "▤", detail: "作者合集" },
  { key: "music", title: "音乐", icon: "♪", detail: "音乐作品" },
  { key: "collect", title: "收藏夹", icon: "◇", detail: "账号收藏" },
  { key: "collectmix", title: "收藏合集", icon: "◆", detail: "收藏合集" },
];

const VIEW_META = {
  download: { title: "下载", eyebrow: "下载链接" },
  following: { title: "我的关注", eyebrow: "账号内容" },
  collections: { title: "我的收藏", eyebrow: "账号内容" },
  preview: { title: "作者预览", eyebrow: "主页解析" },
  batch: { title: "批量下载", eyebrow: "批量任务" },
  live: { title: "直播录制", eyebrow: "实验性功能" },
  tasks: { title: "任务中心", eyebrow: "下载队列" },
  archive: { title: "下载记录", eyebrow: "本地历史" },
  settings: { title: "设置", eyebrow: "偏好" },
};

const WORK_MODE_LABELS = {
  post: "作品",
  like: "喜欢",
  mix: "合集",
  music: "音乐",
};

const PREVIEW_CARDS = [
  { key: "post", title: "作品", icon: "▣", detail: "作者公开作品", source: "author" },
  { key: "like", title: "喜欢", icon: "♡", detail: "作者喜欢列表", source: "author" },
  { key: "mix", title: "合集", icon: "▤", detail: "作者合集", source: "author" },
  { key: "music", title: "音乐", icon: "♪", detail: "作者音乐作品", source: "author" },
];

const state = {
  view: "download",
  config: null,
  selectedModes: new Set(["post"]),
  modeNumbers: {},
  modeIncrease: {},
  parsed: null,
  previewAuthor: null,
  jobs: [],
  activeJobId: "",
  taskFilter: "all",
  followLayout: "list",
  following: [],
  followingSyncing: false,
  selectedFollowing: new Set(),
  collections: { folders: [], mixes: [] },
  collectionFilter: "all",
  authorWorks: {
    visible: false,
    author: null,
    mode: "post",
    items: [],
    cursor: 0,
    hasMore: false,
    loading: false,
    selected: new Set(),
    returnView: "preview",
  },
  collectionWorks: {
    visible: false,
    collection: null,
    items: [],
    cursor: 0,
    hasMore: false,
    loading: false,
    selected: new Set(),
  },
  liveJobId: "",
  archive: { total: 0, page: 1, items: [] },
  archiveAuthors: [],
  archiveDetailAuthor: "",
  topAuthors: [],
  selectedArchive: new Set(),
  account: { verified: false, profile: null, verifying: false, error: "" },
  loginPollTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function renderErrorText(value) {
  if (!value) return "";
  if (typeof Event !== "undefined" && value instanceof Event) return "";
  if (value instanceof Error) return value.message;
  return String(value);
}

function normalizeExtractedUrl(value) {
  return String(value || "").replace(/[.,!?，。！？)]+$/g, "");
}

function extractUrls(text) {
  const value = String(text || "");
  const matches = value.match(DOUYIN_URL_GLOBAL_RE) || value.match(GENERIC_URL_GLOBAL_RE) || [];
  return matches.map(normalizeExtractedUrl).filter(Boolean);
}

function extractUrl(text) {
  const value = String(text || "").trim();
  const match = value.match(DOUYIN_URL_RE) || value.match(GENERIC_URL_RE);
  if (!match) return value;
  return normalizeExtractedUrl(match[0]);
}

function formatNumber(value) {
  const num = Number(value || 0);
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
  return String(num);
}

function formatDate(value) {
  if (!value) return "未记录";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleDateString("zh-CN");
}

function formatTime(value) {
  if (!value) return "未记录";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN");
}

function statusText(status) {
  return (
    {
      pending: "等待中",
      running: "运行中",
      success: "已完成",
      failed: "失败",
      cancelled: "已取消",
    }[status] || status || "未知"
  );
}

function typeText(type) {
  return (
    {
      short: "抖音短链",
      video: "视频",
      user: "用户主页",
      gallery: "图文",
      collection: "合集",
      mix: "合集",
      music: "音乐",
      live: "直播",
      folder: "收藏夹",
    }[type] || type || "未知"
  );
}

function progressData(job) {
  if (!job) return { value: 0, label: "0%", indeterminate: false };
  const total = Number(job.total || 0);
  const success = Number(job.success || 0);
  const failed = Number(job.failed || 0);
  const skipped = Number(job.skipped || 0);
  const done = success + failed + skipped;
  const terminal = job.status === "success" || job.status === "failed" || job.status === "cancelled";
  if (total > 0) {
    if (!terminal && done === 0) {
      return { value: 36, label: `0/${total}`, indeterminate: true };
    }
    const value = terminal ? 100 : Math.min(99, Math.max(2, Math.round((done / total) * 100)));
    return { value, label: `${done}/${total}`, indeterminate: false };
  }
  if (job.status === "running") {
    return { value: 36, label: job.step || "解析中", indeterminate: true };
  }
  if (job.status === "pending") {
    return { value: 0, label: "等待中", indeterminate: false };
  }
  return { value: 100, label: statusText(job.status), indeterminate: false };
}

function progressOf(job) {
  return progressData(job).value;
}

function jobDetailText(job) {
  return [job?.step, job?.detail].filter(Boolean).join(" · ");
}

function downloadStatePill(item) {
  const state = item?.download_state || {};
  if (state.status === "available") {
    return `<span class="pill download-state-pill available" title="${escapeAttr(state.path || "")}">已下载</span>`;
  }
  if (state.status === "missing") {
    return `<span class="pill download-state-pill missing" title="${escapeAttr(state.path || "")}">已下载 · 文件已删除</span>`;
  }
  return "";
}

function workMetaHtml(item) {
  const baseMeta = item.type === "video" || item.type === "gallery"
    ? `<span class="pill">${escapeHtml(formatDate(item.create_time))}</span><span class="pill">赞 ${formatNumber(item.stats?.digg)}</span>`
    : `<span class="pill">数量 ${formatNumber(item.count)}</span>`;
  return `<span class="pill">${escapeHtml(typeText(item.type))}</span>${baseMeta}${downloadStatePill(item)}`;
}

function renderWorkCard(item, options) {
  const key = options.key;
  const selected = Boolean(options.selected);
  const cover = item.cover
    ? `<img src="${escapeAttr(item.cover)}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(typeText(item.type).slice(0, 2));
  return `
    <article class="work-card ${selected ? "selected" : ""}" ${options.cardKeyAttr}="${escapeAttr(key)}">
      <div class="work-cover">
        ${cover}
        <label class="work-select"><input type="checkbox" ${selected ? "checked" : ""} ${options.selectAttr}="${escapeAttr(key)}" /></label>
      </div>
      <div class="work-body">
        <div class="work-title">${escapeHtml(item.title || item.id)}</div>
        <div class="card-meta">${workMetaHtml(item)}</div>
      </div>
      <div class="work-actions">
        <button class="secondary-button compact" type="button" ${options.downloadAttr}="${escapeAttr(key)}">下载</button>
        <button class="ghost-button compact" type="button" ${options.copyAttr}="${escapeAttr(item.url || "")}">复制</button>
      </div>
    </article>
  `;
}

function currentModeOverrides() {
  return {
    mode: Array.from(state.selectedModes),
    number: state.modeNumbers,
    increase: state.modeIncrease,
  };
}

async function api(path, options = {}) {
  const init = {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };
  const response = await fetch(`${API}${path}`, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return response.json();
}

function toast(message, type = "info") {
  const host = $("#toastHost");
  if (!host) return;
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  host.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

function setHealth(ok, text) {
  const health = $("#apiHealth");
  if (!health) return;
  const dot = health.querySelector(".status-dot");
  health.querySelector("span:last-child").textContent = text;
  dot.classList.toggle("ok", ok);
  dot.classList.toggle("bad", !ok);
}

async function refreshConfig() {
  state.config = await api("/config");
  state.selectedModes = new Set(
    (state.config.mode || ["post"]).map((mode) => (mode === "allmix" ? "mix" : mode)),
  );
  if (state.selectedModes.size === 0) state.selectedModes.add("post");
  state.modeNumbers = { ...(state.config.number || {}) };
  state.modeIncrease = { ...(state.config.increase || {}) };
  renderAccountState();
  renderModes();
  fillSettingsForm();
  if (state.config.cookies?.auth_ready && !state.account.verified) {
    verifyAccount({ silent: true });
  }
}

function renderAccountState() {
  const cookies = state.config?.cookies || {};
  const dot = $("#accountDot");
  const text = $("#accountText");
  if (!dot || !text) return;
  if (state.account.verified) {
    dot.className = "status-dot ok";
    text.textContent = "已登录";
  } else if (state.account.verifying) {
    dot.className = "status-dot";
    text.textContent = "验证中";
  } else if (cookies.auth_ready) {
    dot.className = "status-dot";
    text.textContent = "Cookie 待验证";
  } else if (cookies.session_present) {
    dot.className = "status-dot";
    text.textContent = "Cookie 不完整";
  } else if (cookies.present) {
    dot.className = "status-dot bad";
    text.textContent = "Cookie 无会话";
  } else {
    dot.className = "status-dot bad";
    text.textContent = "未登录";
  }

  const accountName = state.account.profile?.nickname;
  const settingsState = $("#settingsCookieState");
  if (settingsState) {
    settingsState.textContent = state.account.verified
      ? `已验证账号：${accountName || "抖音账号"}`
      : state.account.verifying
        ? "正在验证抖音账号"
        : cookies.auth_ready
          ? "Cookie 存在，等待账号验证"
          : cookies.session_present
            ? "检测到会话 Cookie，等待补全关键字段"
            : cookies.present
              ? "检测到 Cookie，但没有登录会话"
              : "未检测到 Cookie";
  }
  const missing = Array.isArray(cookies.missing_required) && cookies.missing_required.length
    ? `；缺少 ${cookies.missing_required.join(", ")}`
    : "";
  const cookieFile = $("#cookieFile");
  if (cookieFile) {
    cookieFile.textContent = cookies.cookie_file
      ? `Cookie 文件：${cookies.cookie_file}；本地 ${Number(cookies.count || 0)} 项${missing}`
      : "Cookie 文件：未配置";
  }
}

function renderModes() {
  const grid = $("#modeGrid");
  if (!grid) return;
  grid.innerHTML = MODES.map((mode) => {
    const selected = state.selectedModes.has(mode.key);
    const count = Number(state.modeNumbers[mode.key] || 0);
    const increase = Boolean(state.modeIncrease[mode.key]);
    return `
      <article class="mode-card ${selected ? "selected" : ""}" data-mode="${mode.key}">
        <div class="mode-title">
          <span>${mode.icon}</span>
          <strong>${mode.title}</strong>
        </div>
        <small>${mode.detail}</small>
        <div class="mode-controls">
          <input class="mode-count" type="number" min="0" value="${count}" data-mode-count="${mode.key}" title="下载数量，0 为全部" />
          <label class="mini-toggle"><input type="checkbox" ${increase ? "checked" : ""} data-mode-increase="${mode.key}" />增量</label>
        </div>
      </article>
    `;
  }).join("");

  const selectedNames = MODES.filter((mode) => state.selectedModes.has(mode.key)).map((mode) => mode.title);
  $("#modeSummary").textContent = selectedNames.length ? selectedNames.join(" / ") : "未选择";

  $$(".mode-card").forEach((card) => {
    card.addEventListener("click", () => toggleMode(card.dataset.mode));
  });
  $$("[data-mode-count]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("input", () => {
      state.modeNumbers[input.dataset.modeCount] = Math.max(0, Number(input.value || 0));
    });
  });
  $$("[data-mode-increase]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      state.modeIncrease[input.dataset.modeIncrease] = input.checked;
    });
  });
}

function toggleMode(mode) {
  const exclusive = mode === "collect" || mode === "collectmix";
  if (exclusive) {
    state.selectedModes = new Set(state.selectedModes.has(mode) ? [] : [mode]);
  } else {
    state.selectedModes.delete("collect");
    state.selectedModes.delete("collectmix");
    if (state.selectedModes.has(mode)) state.selectedModes.delete(mode);
    else state.selectedModes.add(mode);
  }
  if (state.selectedModes.size === 0) state.selectedModes.add("post");
  renderModes();
}

function renderPreview() {
  const grid = $("#previewModeGrid");
  if (!grid) return;
  const author = state.previewAuthor;
  const result = $("#previewAuthorResult");
  const badge = $("#previewResolveBadge");
  if (result && badge) {
    if (author?.sec_uid) {
      const avatar = author.avatar
        ? `<img src="${escapeAttr(author.avatar)}" alt="" referrerpolicy="no-referrer" />`
        : escapeHtml(String(author.nickname || "?").slice(0, 1));
      badge.textContent = "已解析";
      result.classList.remove("muted");
      result.innerHTML = `
        <div class="author-profile compact-profile">
          <div class="avatar">${avatar}</div>
          <div>
            <h3>${escapeHtml(author.nickname || "作者")}</h3>
            <p>${escapeHtml(author.signature || author.sec_uid || "")}</p>
            <div class="card-meta">
              <span class="pill">作品 ${formatNumber(author.aweme_count)}</span>
              <span class="pill">粉丝 ${formatNumber(author.follower_count)}</span>
              <span class="pill">${escapeHtml(author.sec_uid || "")}</span>
            </div>
          </div>
        </div>
      `;
    } else {
      badge.textContent = "待解析";
      result.classList.add("muted");
      result.textContent = "等待输入";
    }
  }

  grid.innerHTML = PREVIEW_CARDS.map((card) => {
    const needsAuthor = card.source === "author";
    const hint = needsAuthor && !author?.sec_uid ? "先解析作者主页" : "点击预览";
    return `
      <button class="mode-card preview-mode-card" type="button" data-preview-mode="${escapeAttr(card.key)}">
        <div class="mode-title">
          <span>${escapeHtml(card.icon)}</span>
          <strong>${escapeHtml(card.title)}</strong>
        </div>
        <small>${escapeHtml(card.detail)}</small>
        <div class="card-meta">
          <span class="pill">${escapeHtml(hint)}</span>
        </div>
      </button>
    `;
  }).join("");

  $$("[data-preview-mode]", grid).forEach((button) => {
    button.addEventListener("click", () => openPreviewMode(button.dataset.previewMode));
  });
}

async function resolvePreviewAuthor() {
  const raw = $("#previewUrlInput").value.trim();
  if (!raw) {
    toast("请输入作者主页链接或分享文案", "error");
    return null;
  }
  const cleaned = extractUrl(raw);
  $("#previewUrlInput").value = cleaned;
  $("#previewResolveBadge").textContent = "解析中";
  try {
    const result = await api("/author/resolve", {
      method: "POST",
      body: JSON.stringify({ url: cleaned }),
    });
    state.previewAuthor = result.profile || { sec_uid: result.sec_uid, nickname: result.sec_uid };
    if (result.url) $("#previewUrlInput").value = result.url;
    renderPreview();
    return state.previewAuthor;
  } catch (error) {
    state.previewAuthor = null;
    $("#previewResolveBadge").textContent = "解析失败";
    $("#previewAuthorResult").classList.remove("muted");
    $("#previewAuthorResult").textContent = error.message;
    toast(`解析作者失败：${error.message}`, "error");
    renderPreview();
    return null;
  }
}

async function openPreviewMode(mode) {
  const card = PREVIEW_CARDS.find((item) => item.key === mode);
  if (!card) return;

  let author = state.previewAuthor;
  if (!author?.sec_uid) {
    author = await resolvePreviewAuthor();
  }
  if (!author?.sec_uid) return;
  openAuthorWorks(author.sec_uid, {
    author,
    mode,
    returnView: "preview",
  });
}

async function saveModeConfig() {
  const payload = currentModeOverrides();
  const result = await api("/config", { method: "PATCH", body: JSON.stringify(payload) });
  state.config = result.config;
  return result;
}

async function parseUrl() {
  const raw = $("#urlInput").value.trim();
  if (!raw) {
    toast("请输入链接或分享文案", "error");
    return null;
  }
  $("#parseBadge").textContent = "检测中";
  const candidate = extractUrl(raw);
  try {
    const result = await api("/parse", { method: "POST", body: JSON.stringify({ url: raw }) });
    state.parsed = result;
    const parsedType = result.parsed?.type;
    if (result.url) $("#urlInput").value = result.url;
    $("#parseBadge").textContent = result.supported ? "可下载" : "未支持";
    renderDownloadLiveOptions(parsedType === "live" && result.supported);
    $("#parseResult").classList.toggle("muted", false);
    $("#parseResult").innerHTML = `
      <strong>${result.supported ? "已识别" : "未识别"}</strong>
      <span class="pill">${escapeHtml(typeText(parsedType))}</span>
      <div class="muted">${escapeHtml(result.url || candidate)}</div>
    `;
    return result;
  } catch (error) {
    $("#parseBadge").textContent = "检测失败";
    renderDownloadLiveOptions(false);
    $("#parseResult").textContent = error.message;
    toast(`检测失败：${error.message}`, "error");
    return null;
  }
}

function quickLiveOverridesFromForm() {
  return {
    live: {
      max_duration_seconds: Math.max(0, Number($("#quickLiveMaxDuration").value || 0)),
      idle_timeout_seconds: Math.max(1, Number($("#quickLiveIdleTimeout").value || 30)),
      convert_to_mp4: $("#quickLiveConvertToMp4") ? $("#quickLiveConvertToMp4").checked : true,
      keep_source_flv: $("#quickLiveKeepSourceFlv") ? $("#quickLiveKeepSourceFlv").checked : true,
    },
  };
}

function fillQuickLiveFormFromConfig() {
  const live = state.config?.live || {};
  if ($("#quickLiveMaxDuration")) $("#quickLiveMaxDuration").value = live.max_duration_seconds ?? 0;
  if ($("#quickLiveIdleTimeout")) $("#quickLiveIdleTimeout").value = live.idle_timeout_seconds ?? 30;
  if ($("#quickLiveConvertToMp4")) $("#quickLiveConvertToMp4").checked = live.convert_to_mp4 !== false;
  if ($("#quickLiveKeepSourceFlv")) $("#quickLiveKeepSourceFlv").checked = live.keep_source_flv !== false;
}

function renderDownloadLiveOptions(show) {
  const panel = $("#downloadLiveOptions");
  if (!panel) return;
  panel.classList.toggle("hidden", !show);
}

async function createDownload(rawUrl, overrides = currentModeOverrides()) {
  const result = await api("/download", {
    method: "POST",
    body: JSON.stringify({ url: rawUrl, ...overrides }),
  });
  state.activeJobId = result.job_id;
  await refreshJobs();
  toast(`任务已创建：${result.job_id}，可在任务中心查看`);
  return result;
}

async function startDownload() {
  const raw = $("#urlInput").value.trim();
  if (!raw) {
    toast("请输入链接或分享文案", "error");
    return;
  }
  const cleaned = extractUrl(raw);
  $("#urlInput").value = cleaned;
  $("#startDownloadBtn").disabled = true;
  try {
    let parsed = state.parsed;
    if (!parsed || parsed.url !== cleaned) {
      parsed = await parseUrl();
      if (!parsed) return;
    }
    const isLive = parsed?.supported && parsed?.parsed?.type === "live";
    const submitUrl = parsed?.url || cleaned;
    $("#urlInput").value = submitUrl;
    await createDownload(submitUrl, isLive ? quickLiveOverridesFromForm() : currentModeOverrides());
  } catch (error) {
    toast(`创建失败：${error.message}`, "error");
  } finally {
    $("#startDownloadBtn").disabled = false;
  }
}

async function startBatch() {
  const raw = $("#batchInput").value;
  const extracted = extractUrls(raw);
  const lines = extracted.length
    ? extracted
    : raw.split(/\r?\n/).map((line) => extractUrl(line)).filter(Boolean);
  if (!lines.length) {
    toast("请输入批量链接", "error");
    return;
  }
  $("#batchInput").value = lines.join("\n");
  $("#batchResult").textContent = `已识别 ${lines.length} 个链接`;
  $("#startBatchBtn").disabled = true;
  let ok = 0;
  const failures = [];
  try {
    const overrides = currentModeOverrides();
    for (const line of lines) {
      try {
        await api("/download", {
          method: "POST",
          body: JSON.stringify({ url: line, ...overrides }),
        });
        ok += 1;
      } catch (error) {
        failures.push(`${extractUrl(line)}：${error.message}`);
      }
    }
    $("#batchResult").textContent = `已创建 ${ok} 个任务，失败 ${failures.length} 个`;
    if (failures.length) toast(failures[0], "error");
    await refreshJobs();
    toast(`批量任务已创建：成功 ${ok} 个，失败 ${failures.length} 个`);
  } finally {
    $("#startBatchBtn").disabled = false;
  }
}

async function refreshJobs() {
  const result = await api("/jobs");
  state.jobs = [...(result.jobs || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  renderActiveJob();
  renderLiveStatus();
  renderTasks();
}

function renderActiveJob() {
  const active =
    state.jobs.find((job) => job.job_id === state.activeJobId) ||
    state.jobs.find((job) => job.status === "running") ||
    state.jobs.find((job) => job.status === "pending") ||
    state.jobs[0];
  const target = $("#activeJobCard");
  const cancelBtn = $("#cancelActiveJobBtn");
  if (!target || !cancelBtn) return;
  if (!active || ["success", "failed"].includes(active.status)) {
    $("#activitySubtitle").textContent = active ? `最近任务：${statusText(active.status)}` : "空闲";
    cancelBtn.disabled = true;
    target.className = "job-focus empty-state";
    target.innerHTML = `<div class="empty-symbol">↓</div><div>${active ? escapeHtml(active.job_id) : "暂无运行任务"}</div>`;
    setFlow(0);
    return;
  }
  state.activeJobId = active.job_id;
  const progress = progressData(active);
  const detailText = jobDetailText(active);
  $("#activitySubtitle").textContent = `${statusText(active.status)} · ${active.job_id}`;
  cancelBtn.disabled = false;
  target.className = "job-focus";
  target.innerHTML = `
    <div class="task-title">${escapeHtml(active.url)}</div>
    ${detailText ? `<div class="task-subtitle">${escapeHtml(detailText)}</div>` : ""}
    <div class="progress-track"><div class="progress-bar ${progress.indeterminate ? "indeterminate" : ""}" style="width:${progress.value}%"></div></div>
    <div class="job-meta">
      <span class="pill">进度 ${escapeHtml(progress.label)}</span>
      <span class="pill">总数 ${Number(active.total || 0)}</span>
      <span class="pill">成功 ${Number(active.success || 0)}</span>
      <span class="pill">失败 ${Number(active.failed || 0)}</span>
      <span class="pill">跳过 ${Number(active.skipped || 0)}</span>
    </div>
  `;
  setFlow(active.status === "pending" ? 1 : 2);
}

function setFlow(activeIndex) {
  $$(".flow-step").forEach((item, index) => {
    item.classList.toggle("active", index <= activeIndex);
  });
}

function renderTasks() {
  if (!$("#taskList")) return;
  const total = state.jobs.length;
  const running = state.jobs.filter((job) => ["running", "pending"].includes(job.status)).length;
  const done = state.jobs.filter((job) => job.status === "success").length;
  const failed = state.jobs.filter((job) => job.status === "failed").length;
  $("#taskTotal").textContent = total;
  $("#taskRunning").textContent = running;
  $("#taskDone").textContent = done;
  $("#taskFailed").textContent = failed;

  const query = $("#taskSearch").value.trim().toLowerCase();
  const jobs = state.jobs.filter((job) => {
    const filterOk =
      state.taskFilter === "all" ||
      (state.taskFilter === "running" && ["running", "pending"].includes(job.status)) ||
      job.status === state.taskFilter;
    const text = `${job.job_id} ${job.url} ${job.step || ""} ${job.detail || ""} ${job.error || ""}`.toLowerCase();
    return filterOk && (!query || text.includes(query));
  });

  const list = $("#taskList");
  if (!jobs.length) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">▣</div><h2>暂无任务</h2></div>`;
    return;
  }

  list.innerHTML = jobs.map((job) => {
    const progress = progressData(job);
    const canCancel = ["running", "pending"].includes(job.status);
    const detailText = jobDetailText(job);
    return `
      <article class="task-card" data-job-id="${escapeAttr(job.job_id)}">
        <div>
          <div class="task-title">${escapeHtml(job.url)}</div>
          <div class="task-subtitle">${escapeHtml(job.job_id)} · ${escapeHtml(formatTime(job.created_at))}</div>
          ${detailText ? `<div class="task-subtitle">${escapeHtml(detailText)}</div>` : ""}
        </div>
        <div class="progress-track"><div class="progress-bar ${progress.indeterminate ? "indeterminate" : ""}" style="width:${progress.value}%"></div></div>
        <div class="job-meta">
          <span class="pill">${escapeHtml(statusText(job.status))}</span>
          <span class="pill">进度 ${escapeHtml(progress.label)}</span>
          <span class="pill">总数 ${Number(job.total || 0)}</span>
          <span class="pill">成功 ${Number(job.success || 0)}</span>
          <span class="pill">失败 ${Number(job.failed || 0)}</span>
          <span class="pill">跳过 ${Number(job.skipped || 0)}</span>
          ${job.error ? `<span class="pill">${escapeHtml(job.error)}</span>` : ""}
        </div>
        <div class="task-actions">
          <button class="ghost-button compact" type="button" data-copy-job="${escapeAttr(job.url)}">复制链接</button>
          <button class="ghost-button compact danger" type="button" data-delete-job="${escapeAttr(job.job_id)}">${canCancel ? "取消" : "删除"}</button>
        </div>
      </article>
    `;
  }).join("");

  $$("[data-delete-job]", list).forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/jobs/${button.dataset.deleteJob}`, { method: "DELETE" });
        await refreshJobs();
      } catch (error) {
        toast(`删除失败：${error.message}`, "error");
      }
    });
  });
  $$("[data-copy-job]", list).forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyJob || ""));
  });
}

async function clearDoneJobs() {
  try {
    const result = await api("/jobs", { method: "DELETE" });
    toast(`已清理 ${result.deleted || 0} 个完成任务`);
    await refreshJobs();
  } catch (error) {
    toast(`清理失败：${error.message}`, "error");
  }
}

async function cancelActiveJob() {
  if (!state.activeJobId) return;
  try {
    await api(`/jobs/${state.activeJobId}`, { method: "DELETE" });
    state.activeJobId = "";
    await refreshJobs();
  } catch (error) {
    toast(`取消失败：${error.message}`, "error");
  }
}

async function syncFollowing() {
  if (state.followingSyncing) return;
  let errorMessage = "";
  state.followingSyncing = true;
  $("#syncFollowingBtn").disabled = true;
  $("#followSyncState").textContent = "同步中";
  renderFollowing();
  try {
    const result = await api("/following/sync", {
      method: "POST",
      body: JSON.stringify({ limit: 80 }),
    });
    state.following = result.items || [];
    state.selectedFollowing.clear();
    $("#followSyncState").textContent = `${state.following.length} 个关注`;
    closeAuthorWorks();
    toast("关注列表已同步");
  } catch (error) {
    $("#followSyncState").textContent = "同步失败";
    errorMessage = error.message;
  } finally {
    state.followingSyncing = false;
    $("#syncFollowingBtn").disabled = false;
    renderFollowing(errorMessage);
  }
}

function renderFollowing(errorMessage = "") {
  errorMessage = renderErrorText(errorMessage);
  const list = $("#followingList");
  if (!list) return;
  list.classList.toggle("grid-layout", state.followLayout === "grid");
  $("#downloadSelectedFollowBtn").disabled = state.selectedFollowing.size === 0;

  const query = $("#followSearch").value.trim().toLowerCase();
  const sort = $("#followSort").value;
  let items = state.following.filter((item) => {
    const text = `${item.nickname || ""} ${item.signature || ""} ${item.sec_uid || ""}`.toLowerCase();
    return !query || text.includes(query);
  });
  items = items.sort((a, b) => {
    if (sort === "aweme") return Number(b.aweme_count || 0) - Number(a.aweme_count || 0);
    if (sort === "fans") return Number(b.follower_count || 0) - Number(a.follower_count || 0);
    return String(a.nickname || "").localeCompare(String(b.nickname || ""), "zh-Hans-CN");
  });

  if (errorMessage) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">◇</div><h2>同步失败</h2><p>${escapeHtml(errorMessage)}</p></div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">◎</div><h2>${state.followingSyncing ? "正在同步关注" : "暂无关注数据"}</h2></div>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const secUid = item.sec_uid || "";
    const checked = state.selectedFollowing.has(secUid);
    const avatar = item.avatar
      ? `<img src="${escapeAttr(item.avatar)}" alt="" referrerpolicy="no-referrer" />`
      : escapeHtml(String(item.nickname || "?").slice(0, 1));
    return `
      <article class="entity-row" data-follow-sec-uid="${escapeAttr(secUid)}">
        <label class="mini-toggle"><input type="checkbox" ${checked ? "checked" : ""} data-follow-select="${escapeAttr(secUid)}" /></label>
        <button class="avatar avatar-button" type="button" data-open-author="${escapeAttr(secUid)}" title="作品浏览">${avatar}</button>
        <div class="entity-main">
          <div class="entity-title">${escapeHtml(item.nickname || "未命名账号")}</div>
          <div class="entity-subtitle">${escapeHtml(item.signature || secUid)}</div>
          <div class="card-meta">
            <span class="pill">作品 ${formatNumber(item.aweme_count)}</span>
            <span class="pill">粉丝 ${formatNumber(item.follower_count)}</span>
            <span class="pill">关注 ${formatNumber(item.following_count)}</span>
          </div>
        </div>
        <div class="entity-actions">
          <button class="secondary-button compact" type="button" data-download-user="${escapeAttr(secUid)}">下载</button>
        </div>
      </article>
    `;
  }).join("");

  $$("[data-follow-select]", list).forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedFollowing.add(input.dataset.followSelect);
      else state.selectedFollowing.delete(input.dataset.followSelect);
      $("#downloadSelectedFollowBtn").disabled = state.selectedFollowing.size === 0;
    });
  });
  $$("[data-open-author]", list).forEach((button) => {
    button.addEventListener("click", () => openAuthorWorks(button.dataset.openAuthor, { returnView: "following" }));
  });
  $$("[data-download-user]", list).forEach((button) => {
    button.addEventListener("click", () => downloadUsers([button.dataset.downloadUser]));
  });
}

function selectedFollowDownloadMode() {
  return $("#followDownloadMode")?.value || "post";
}

async function downloadUsers(secUids, mode = selectedFollowDownloadMode()) {
  const valid = secUids.filter(Boolean);
  if (!valid.length) return;
  const safeMode = WORK_MODE_LABELS[mode] ? mode : "post";
  try {
    for (const secUid of valid) {
      await api("/download", {
        method: "POST",
        body: JSON.stringify({
          url: `https://www.douyin.com/user/${secUid}`,
          mode: [safeMode],
        }),
      });
    }
    toast(`已创建 ${valid.length} 个${WORK_MODE_LABELS[safeMode]}下载任务`);
    await refreshJobs();
  } catch (error) {
    toast(`创建失败：${error.message}`, "error");
  }
}

function openAuthorWorks(secUid, options = {}) {
  const author = options.author || state.following.find((item) => item.sec_uid === secUid);
  if (state.view !== "preview") showView("preview");
  state.authorWorks.visible = true;
  state.authorWorks.author = author || { sec_uid: secUid, nickname: secUid };
  state.authorWorks.mode = options.mode || "post";
  state.authorWorks.items = [];
  state.authorWorks.cursor = 0;
  state.authorWorks.hasMore = false;
  state.authorWorks.returnView = options.returnView || "preview";
  state.authorWorks.selected.clear();
  $("#authorWorksPanel").classList.remove("hidden");
  $$("#workModeTabs button").forEach((button) => button.classList.toggle("active", button.dataset.workMode === state.authorWorks.mode));
  renderPreview();
  loadAuthorWorks({ reset: true });
}

function closeAuthorWorks({ navigate = true } = {}) {
  const returnView = state.authorWorks.returnView || "preview";
  state.authorWorks.visible = false;
  state.authorWorks.items = [];
  state.authorWorks.cursor = 0;
  state.authorWorks.hasMore = false;
  state.authorWorks.returnView = "preview";
  state.authorWorks.selected.clear();
  const panel = $("#authorWorksPanel");
  if (panel) panel.classList.add("hidden");
  if (navigate && returnView && returnView !== "preview") {
    showView(returnView);
  } else if (state.view === "preview") {
    renderPreview();
  }
}

async function loadAuthorWorks({ reset = false } = {}) {
  const author = state.authorWorks.author;
  if (!author?.sec_uid || state.authorWorks.loading) return;
  if (reset) {
    state.authorWorks.items = [];
    state.authorWorks.cursor = 0;
    state.authorWorks.hasMore = false;
    state.authorWorks.selected.clear();
  }
  state.authorWorks.loading = true;
  renderAuthorWorks();
  try {
    const params = new URLSearchParams({
      mode: state.authorWorks.mode,
      cursor: String(reset ? 0 : state.authorWorks.cursor || 0),
      count: "24",
    });
    const result = await api(`/users/${encodeURIComponent(author.sec_uid)}/works?${params.toString()}`);
    if (result.profile) {
      state.authorWorks.author = { ...state.authorWorks.author, ...result.profile };
    }
    const incoming = result.items || [];
    const seen = new Set(state.authorWorks.items.map((item) => `${item.type}:${item.id}`));
    for (const item of incoming) {
      const key = `${item.type}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        state.authorWorks.items.push(item);
      }
    }
    state.authorWorks.cursor = Number(result.cursor || 0);
    state.authorWorks.hasMore = Boolean(result.has_more) && state.authorWorks.cursor > 0;
  } catch (error) {
    toast(`读取作品失败：${error.message}`, "error");
  } finally {
    state.authorWorks.loading = false;
    renderAuthorWorks();
  }
}

function filteredAuthorWorks() {
  const query = $("#workSearch").value.trim().toLowerCase();
  const type = $("#workTypeFilter").value;
  const sort = $("#workSort").value;
  const fromValue = $("#workDateFrom").value;
  const toValue = $("#workDateTo").value;
  const from = fromValue ? new Date(`${fromValue}T00:00:00`).getTime() / 1000 : null;
  const to = toValue ? new Date(`${toValue}T23:59:59`).getTime() / 1000 : null;

  const items = state.authorWorks.items.filter((item) => {
    const text = `${item.title || ""} ${item.desc || ""}`.toLowerCase();
    const date = Number(item.create_time || 0);
    return (
      (!query || text.includes(query)) &&
      (!type || item.type === type) &&
      (!from || !date || date >= from) &&
      (!to || !date || date <= to)
    );
  });

  items.sort((a, b) => {
    if (sort === "digg") return Number(b.stats?.digg || 0) - Number(a.stats?.digg || 0);
    if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
    return Number(b.create_time || 0) - Number(a.create_time || 0);
  });
  return items;
}

function renderAuthorWorks() {
  const panel = $("#authorWorksPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !state.authorWorks.visible);
  if (!state.authorWorks.visible) return;

  const author = state.authorWorks.author || {};
  const avatar = author.avatar
    ? `<img src="${escapeAttr(author.avatar)}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(String(author.nickname || "?").slice(0, 1));
  $("#authorWorksProfile").innerHTML = `
    <div class="avatar">${avatar}</div>
    <div>
      <h3>${escapeHtml(author.nickname || author.sec_uid || "作者")}</h3>
      <p>${escapeHtml(author.signature || author.sec_uid || "")}</p>
      <div class="card-meta">
        <span class="pill">${escapeHtml(WORK_MODE_LABELS[state.authorWorks.mode])}</span>
        <span class="pill">已载入 ${state.authorWorks.items.length}</span>
      </div>
    </div>
  `;
  $("#downloadSelectedWorksBtn").disabled = state.authorWorks.selected.size === 0;
  $("#loadMoreWorksBtn").disabled = state.authorWorks.loading || !state.authorWorks.hasMore;
  $("#loadMoreWorksBtn").textContent = state.authorWorks.loading ? "加载中" : "加载更多";

  const list = $("#authorWorksList");
  const items = filteredAuthorWorks();
  if (!items.length) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">▤</div><h2>${state.authorWorks.loading ? "加载中" : "暂无内容"}</h2></div>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const key = `${item.type}:${item.id}`;
    return renderWorkCard(item, {
      key,
      selected: state.authorWorks.selected.has(key),
      cardKeyAttr: "data-work-key",
      selectAttr: "data-work-select",
      downloadAttr: "data-download-work",
      copyAttr: "data-copy-work",
    });
  }).join("");

  $$("[data-work-select]", list).forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.authorWorks.selected.add(input.dataset.workSelect);
      else state.authorWorks.selected.delete(input.dataset.workSelect);
      renderAuthorWorks();
    });
  });
  $$("[data-download-work]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.authorWorks.items.find((entry) => `${entry.type}:${entry.id}` === button.dataset.downloadWork);
      if (item) downloadWorkItems([item]);
    });
  });
  $$("[data-copy-work]", list).forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyWork || ""));
  });
}

async function downloadWorkItems(items) {
  const valid = items.filter((item) => item?.url);
  if (!valid.length) return;
  try {
    for (const item of valid) {
      await api("/download", {
        method: "POST",
        body: JSON.stringify({ url: item.url }),
      });
    }
    toast(`已创建 ${valid.length} 个作品下载任务，可在任务中心查看`);
    await refreshJobs();
  } catch (error) {
    toast(`创建失败：${error.message}`, "error");
  }
}

async function downloadSelectedWorks() {
  const selected = state.authorWorks.selected;
  const items = state.authorWorks.items.filter((item) => selected.has(`${item.type}:${item.id}`));
  await downloadWorkItems(items);
}

function liveOverridesFromForm() {
  return {
    live: {
      max_duration_seconds: Math.max(0, Number($("#liveMaxDuration").value || 0)),
      idle_timeout_seconds: Math.max(1, Number($("#liveIdleTimeout").value || 30)),
      convert_to_mp4: $("#liveConvertToMp4") ? $("#liveConvertToMp4").checked : true,
      keep_source_flv: $("#liveKeepSourceFlv") ? $("#liveKeepSourceFlv").checked : true,
    },
  };
}

function fillLiveFormFromConfig() {
  const live = state.config?.live || {};
  if ($("#liveMaxDuration")) $("#liveMaxDuration").value = live.max_duration_seconds ?? 0;
  if ($("#liveIdleTimeout")) $("#liveIdleTimeout").value = live.idle_timeout_seconds ?? 30;
  if ($("#liveConvertToMp4")) $("#liveConvertToMp4").checked = live.convert_to_mp4 !== false;
  if ($("#liveKeepSourceFlv")) $("#liveKeepSourceFlv").checked = live.keep_source_flv !== false;
}

function isLiveJob(job) {
  if (!job) return false;
  if (job.overrides?.live) return true;
  return /live\.douyin\.com|\/follow\/live\/|webcast\.amemv\.com/.test(job.url || "");
}

function renderLiveStatus() {
  const badge = $("#liveBadge");
  const result = $("#liveResult");
  const stopBtn = $("#stopLiveBtn");
  if (!badge || !result || !stopBtn) return;
  const liveJob =
    state.jobs.find((job) => job.job_id === state.liveJobId) ||
    state.jobs.find((job) => isLiveJob(job));
  const running = liveJob && ["pending", "running"].includes(liveJob.status);
  stopBtn.disabled = !running;
  if (!liveJob) {
    badge.textContent = "待创建";
    result.classList.add("muted");
    result.textContent = "0 表示不限制录制时长，直到直播结束或手动停止。";
    return;
  }
  state.liveJobId = liveJob.job_id;
  const progress = progressData(liveJob);
  const detail = jobDetailText(liveJob);
  badge.textContent = statusText(liveJob.status);
  result.classList.remove("muted");
  result.innerHTML = `
    <strong>${escapeHtml(liveJob.job_id)}</strong>
    <span class="pill">进度 ${escapeHtml(progress.label)}</span>
    ${detail ? `<span class="pill">${escapeHtml(detail)}</span>` : ""}
  `;
}

async function startLiveRecording() {
  const raw = $("#liveUrlInput").value.trim();
  if (!raw) {
    toast("请输入直播链接", "error");
    return;
  }
  const cleaned = extractUrl(raw);
  $("#liveUrlInput").value = cleaned;
  $("#startLiveBtn").disabled = true;
  $("#liveBadge").textContent = "创建中";
  try {
    const job = await api("/download", {
      method: "POST",
      body: JSON.stringify({ url: cleaned, ...liveOverridesFromForm() }),
    });
    state.liveJobId = job.job_id;
    state.activeJobId = job.job_id;
    await refreshJobs();
    toast(`直播录制任务已创建：${job.job_id}，可在任务中心查看`);
  } catch (error) {
    $("#liveBadge").textContent = "创建失败";
    toast(`直播录制失败：${error.message}`, "error");
  } finally {
    $("#startLiveBtn").disabled = false;
    renderLiveStatus();
  }
}

async function stopLiveRecording() {
  const liveJob =
    state.jobs.find((job) => job.job_id === state.liveJobId) ||
    state.jobs.find((job) => isLiveJob(job));
  if (!liveJob) return;
  try {
    await api(`/jobs/${liveJob.job_id}`, { method: "DELETE" });
    state.liveJobId = "";
    await refreshJobs();
    toast("已停止直播录制任务");
  } catch (error) {
    toast(`停止失败：${error.message}`, "error");
  } finally {
    renderLiveStatus();
  }
}

function openCollectionWorks(item) {
  if (!item?.id) return;
  state.collectionWorks.visible = true;
  state.collectionWorks.collection = item;
  state.collectionWorks.items = [];
  state.collectionWorks.cursor = 0;
  state.collectionWorks.hasMore = false;
  state.collectionWorks.selected.clear();
  $("#collectionWorksPanel").classList.remove("hidden");
  $("#collectionsList").classList.add("hidden");
  loadCollectionWorks({ reset: true });
}

function closeCollectionWorks() {
  state.collectionWorks.visible = false;
  state.collectionWorks.collection = null;
  state.collectionWorks.items = [];
  state.collectionWorks.cursor = 0;
  state.collectionWorks.hasMore = false;
  state.collectionWorks.selected.clear();
  const panel = $("#collectionWorksPanel");
  if (panel) panel.classList.add("hidden");
  const list = $("#collectionsList");
  if (list) list.classList.remove("hidden");
}

async function loadCollectionWorks({ reset = false } = {}) {
  const collection = state.collectionWorks.collection;
  if (!collection?.id || !collection?.type || state.collectionWorks.loading) return;
  if (reset) {
    state.collectionWorks.items = [];
    state.collectionWorks.cursor = 0;
    state.collectionWorks.hasMore = false;
    state.collectionWorks.selected.clear();
  }
  state.collectionWorks.loading = true;
  renderCollectionWorks();
  try {
    const params = new URLSearchParams({
      cursor: String(reset ? 0 : state.collectionWorks.cursor || 0),
      count: "24",
    });
    const result = await api(
      `/collections/${encodeURIComponent(collection.type)}/${encodeURIComponent(collection.id)}/works?${params.toString()}`,
    );
    const incoming = result.items || [];
    const seen = new Set(state.collectionWorks.items.map((item) => `${item.type}:${item.id}`));
    for (const item of incoming) {
      const key = `${item.type}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        state.collectionWorks.items.push(item);
      }
    }
    state.collectionWorks.cursor = Number(result.cursor || 0);
    state.collectionWorks.hasMore = Boolean(result.has_more) && state.collectionWorks.cursor > 0;
  } catch (error) {
    toast(`读取收藏作品失败：${error.message}`, "error");
  } finally {
    state.collectionWorks.loading = false;
    renderCollectionWorks();
  }
}

function filteredCollectionWorks() {
  const query = $("#collectionWorkSearch").value.trim().toLowerCase();
  const type = $("#collectionWorkTypeFilter").value;
  const sort = $("#collectionWorkSort").value;
  const fromValue = $("#collectionWorkDateFrom").value;
  const toValue = $("#collectionWorkDateTo").value;
  const from = fromValue ? new Date(`${fromValue}T00:00:00`).getTime() / 1000 : null;
  const to = toValue ? new Date(`${toValue}T23:59:59`).getTime() / 1000 : null;

  const items = state.collectionWorks.items.filter((item) => {
    const text = `${item.title || ""} ${item.desc || ""}`.toLowerCase();
    const date = Number(item.create_time || 0);
    return (
      (!query || text.includes(query)) &&
      (!type || item.type === type) &&
      (!from || !date || date >= from) &&
      (!to || !date || date <= to)
    );
  });

  items.sort((a, b) => {
    if (sort === "digg") return Number(b.stats?.digg || 0) - Number(a.stats?.digg || 0);
    if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
    return Number(b.create_time || 0) - Number(a.create_time || 0);
  });
  return items;
}

function renderCollectionWorks() {
  const panel = $("#collectionWorksPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !state.collectionWorks.visible);
  const listHost = $("#collectionsList");
  if (listHost) listHost.classList.toggle("hidden", state.collectionWorks.visible);
  if (!state.collectionWorks.visible) return;

  const collection = state.collectionWorks.collection || {};
  const avatar = collection.cover
    ? `<img src="${escapeAttr(collection.cover)}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(typeText(collection.type).slice(0, 2));
  $("#collectionWorksProfile").innerHTML = `
    <div class="avatar">${avatar}</div>
    <div>
      <h3>${escapeHtml(collection.title || collection.id || "收藏内容")}</h3>
      <p>${escapeHtml(collection.id || "")}</p>
      <div class="card-meta">
        <span class="pill">${escapeHtml(typeText(collection.type))}</span>
        <span class="pill">已载入 ${state.collectionWorks.items.length}</span>
        ${Number(collection.count || 0) > 0 ? `<span class="pill">总数 ${formatNumber(collection.count)}</span>` : ""}
      </div>
    </div>
  `;
  $("#downloadSelectedCollectionWorksBtn").disabled = state.collectionWorks.selected.size === 0;
  $("#loadMoreCollectionWorksBtn").disabled = state.collectionWorks.loading || !state.collectionWorks.hasMore;
  $("#loadMoreCollectionWorksBtn").textContent = state.collectionWorks.loading ? "加载中" : "加载更多";

  const list = $("#collectionWorksList");
  const items = filteredCollectionWorks();
  if (!items.length) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">◇</div><h2>${state.collectionWorks.loading ? "加载中" : "暂无内容"}</h2></div>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const key = `${item.type}:${item.id}`;
    return renderWorkCard(item, {
      key,
      selected: state.collectionWorks.selected.has(key),
      cardKeyAttr: "data-collection-work-key",
      selectAttr: "data-collection-work-select",
      downloadAttr: "data-download-collection-work",
      copyAttr: "data-copy-collection-work",
    });
  }).join("");

  $$("[data-collection-work-select]", list).forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.collectionWorks.selected.add(input.dataset.collectionWorkSelect);
      else state.collectionWorks.selected.delete(input.dataset.collectionWorkSelect);
      renderCollectionWorks();
    });
  });
  $$("[data-download-collection-work]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.collectionWorks.items.find((entry) => `${entry.type}:${entry.id}` === button.dataset.downloadCollectionWork);
      if (item) downloadWorkItems([item]);
    });
  });
  $$("[data-copy-collection-work]", list).forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyCollectionWork || ""));
  });
}

async function downloadSelectedCollectionWorks() {
  const selected = state.collectionWorks.selected;
  const items = state.collectionWorks.items.filter((item) => selected.has(`${item.type}:${item.id}`));
  await downloadWorkItems(items);
}

async function syncCollections() {
  $("#syncCollectionsBtn").disabled = true;
  $("#collectionSyncState").textContent = "同步中";
  try {
    const result = await api("/collections/sync", {
      method: "POST",
      body: JSON.stringify({ limit: 120 }),
    });
    state.collections = {
      folders: result.folders || [],
      mixes: result.mixes || [],
    };
    $("#collectionSyncState").textContent = `${state.collections.folders.length} 个收藏夹，${state.collections.mixes.length} 个收藏合集`;
    closeCollectionWorks();
    renderCollections();
    toast("收藏已同步");
  } catch (error) {
    $("#collectionSyncState").textContent = "同步失败";
    renderCollections(error.message);
  } finally {
    $("#syncCollectionsBtn").disabled = false;
  }
}

function collectionItems() {
  const folders = (state.collections.folders || []).map((item) => ({ ...item, type: "folder" }));
  const mixes = (state.collections.mixes || []).map((item) => ({ ...item, type: "mix" }));
  return [...folders, ...mixes];
}

function renderCollections(errorMessage = "") {
  errorMessage = renderErrorText(errorMessage);
  const list = $("#collectionsList");
  if (!list) return;
  const panel = $("#collectionWorksPanel");
  if (panel) panel.classList.toggle("hidden", !state.collectionWorks.visible);
  list.classList.toggle("hidden", state.collectionWorks.visible);
  if (state.collectionWorks.visible) {
    renderCollectionWorks();
    return;
  }
  const folders = state.collections.folders || [];
  const mixes = state.collections.mixes || [];
  $("#downloadAllCollectionsBtn").disabled = folders.length === 0;
  $("#downloadAllCollectMixBtn").disabled = mixes.length === 0;

  if (errorMessage) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">◇</div><h2>同步失败</h2><p>${escapeHtml(errorMessage)}</p></div>`;
    return;
  }

  const query = $("#collectionSearch").value.trim().toLowerCase();
  let items = collectionItems().filter((item) => {
    const typeOk = state.collectionFilter === "all" || item.type === state.collectionFilter;
    const text = `${item.title || ""} ${item.id || ""}`.toLowerCase();
    return typeOk && (!query || text.includes(query));
  });

  if (!items.length) {
    list.innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">◇</div><h2>暂无收藏数据</h2><button class="secondary-button" type="button" data-sync-collections>同步收藏</button></div>`;
    $$("[data-sync-collections]", list).forEach((button) => button.addEventListener("click", syncCollections));
    return;
  }

  list.innerHTML = items.map((item) => {
    const key = `${item.type}:${item.id}`;
    const cover = item.cover
      ? `<img src="${escapeAttr(item.cover)}" alt="" referrerpolicy="no-referrer" />`
      : escapeHtml(typeText(item.type).slice(0, 2));
    return `
      <article class="entity-row">
        <button class="pill pill-button" type="button" data-open-collection="${escapeAttr(key)}">${escapeHtml(typeText(item.type))}</button>
        <button class="avatar avatar-button" type="button" data-open-collection="${escapeAttr(key)}" title="视频浏览">${cover}</button>
        <div class="entity-main">
          <div class="entity-title">${escapeHtml(item.title || item.id)}</div>
          <div class="entity-subtitle">${escapeHtml(item.id || "")}</div>
          <div class="card-meta"><span class="pill">数量 ${formatNumber(item.count)}</span></div>
        </div>
        <div class="entity-actions">
          <button class="secondary-button compact" type="button" data-download-collection="${escapeAttr(`${item.type}:${item.id}`)}">下载</button>
        </div>
      </article>
    `;
  }).join("");

  $$("[data-open-collection]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const [type, id] = String(button.dataset.openCollection || "").split(":");
      const item = collectionItems().find((entry) => entry.type === type && entry.id === id);
      if (item) openCollectionWorks(item);
    });
  });
  $$("[data-download-collection]", list).forEach((button) => {
    button.addEventListener("click", () => {
      const [type, id] = String(button.dataset.downloadCollection || "").split(":");
      const item = collectionItems().find((entry) => entry.type === type && entry.id === id);
      if (item) downloadCollection(item);
    });
  });
}

async function downloadCollection(item) {
  if (!item?.id) return;
  try {
    if (item.type === "folder") {
      await api("/download", {
        method: "POST",
        body: JSON.stringify({
          url: "https://www.douyin.com/user/self?showTab=favorite_collection",
          mode: ["collect"],
          collects_id: item.id,
        }),
      });
    } else {
      await api("/download", {
        method: "POST",
        body: JSON.stringify({ url: item.url || `https://www.douyin.com/collection/${item.id}` }),
      });
    }
    toast("收藏下载任务已创建");
    await refreshJobs();
  } catch (error) {
    toast(`创建失败：${error.message}`, "error");
  }
}

async function downloadAllCollections(type) {
  try {
    const payload =
      type === "mix"
        ? { url: "https://www.douyin.com/user/self?showTab=favorite_collection", mode: ["collectmix"] }
        : { url: "https://www.douyin.com/user/self?showTab=favorite_collection", mode: ["collect"] };
    await api("/download", { method: "POST", body: JSON.stringify(payload) });
    toast("收藏批量下载任务已创建");
    await refreshJobs();
  } catch (error) {
    toast(`创建失败：${error.message}`, "error");
  }
}

async function refreshArchive() {
  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("size", "60");
  const author = $("#archiveAuthor").value.trim();
  const title = $("#archiveTitle").value.trim();
  const type = $("#archiveType").value;
  const from = $("#archiveFrom").value;
  const to = $("#archiveTo").value;
  if (author) params.set("author", author);
  if (title) params.set("title", title);
  if (type) params.set("aweme_type", type);
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  if (state.archiveDetailAuthor) params.set("author", state.archiveDetailAuthor);
  try {
    if (state.archiveDetailAuthor) {
      const archive = await api(`/archive?${params.toString()}`);
      state.archive = archive;
      state.archiveAuthors = [];
      state.topAuthors = [{ author_name: state.archiveDetailAuthor, download_count: archive.total || 0 }];
    } else {
      const authors = await api(`/archive/authors?${params.toString()}`);
      state.archive = { total: authors.total || 0, page: 1, items: [] };
      state.archiveAuthors = authors.items || [];
      state.topAuthors = state.archiveAuthors.slice(0, 6);
    }
    state.selectedArchive.clear();
    renderArchive();
  } catch (error) {
    $("#archiveList").innerHTML = `<div class="surface-panel placeholder-panel"><div class="placeholder-mark">▤</div><h2>读取失败</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderArchive() {
  const detailAuthor = state.archiveDetailAuthor;
  const authors = state.archiveAuthors || [];
  $("#archiveSubtitle").textContent = detailAuthor
    ? `${detailAuthor} · ${Number(state.archive.total || 0)} 个作品`
    : `${authors.length} 位作者，${Number(state.archive.total || 0)} 个作品`;
  $("#topAuthors").innerHTML = state.topAuthors.length
    ? state.topAuthors.map((author) => `
      <button class="author-chip" type="button" data-author-filter="${escapeAttr(author.author_name || "")}">
        <strong>${escapeHtml(author.author_name || "未知作者")}</strong>
        <span>${Number(author.download_count || 0)} 个作品</span>
      </button>
    `).join("")
    : `<div class="author-chip"><strong>暂无作者</strong><span>本地记录</span></div>`;

  $$("[data-author-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.archiveDetailAuthor = button.dataset.authorFilter || "";
      $("#archiveAuthor").value = "";
      refreshArchive();
    });
  });

  const list = $("#archiveList");
  if (!detailAuthor) {
    renderArchiveAuthors(list, authors);
    return;
  }
  renderArchiveItems(list);
}

function renderArchiveAuthors(list, authors) {
  list.className = "archive-author-grid";
  $("#deleteArchiveBtn").disabled = true;
  if (!authors.length) {
    list.innerHTML = `
      <div class="surface-panel placeholder-panel">
        <div class="placeholder-mark">▤</div>
        <h2>暂无下载记录</h2>
        <p>完成下载后，这里会按作者汇总本地作品。</p>
        <div class="button-cluster">
          <button class="primary-button" type="button" data-jump-view="download">去下载</button>
          <button class="secondary-button" type="button" data-jump-view="following">看关注</button>
        </div>
      </div>
    `;
    return;
  }

  list.innerHTML = authors.map((author) => {
    const cover = Array.isArray(author.cover_urls) && author.cover_urls[0]
      ? `<img src="${escapeAttr(author.cover_urls[0])}" alt="" referrerpolicy="no-referrer" />`
      : escapeHtml(String(author.author_name || "作").slice(0, 1));
    const copyPath = author.copy_path || "";
    return `
      <article class="archive-author-card">
        <button class="avatar avatar-button" type="button" data-author-filter="${escapeAttr(author.author_name || "")}">${cover}</button>
        <div class="entity-main">
          <div class="entity-title">${escapeHtml(author.author_name || "未知作者")}</div>
          <div class="entity-subtitle">最近下载：${escapeHtml(formatTime(author.latest_download_time))}</div>
          <div class="card-meta">
            <span class="pill">${Number(author.download_count || 0)} 个作品</span>
            ${copyPath ? `<span class="pill">${escapeHtml(copyPath)}</span>` : ""}
          </div>
        </div>
        <div class="entity-actions">
          <button class="secondary-button compact" type="button" data-author-filter="${escapeAttr(author.author_name || "")}">查看作品</button>
          ${copyPath ? `<button class="ghost-button compact" type="button" data-copy-path="${escapeAttr(copyPath)}">复制路径</button>` : ""}
        </div>
      </article>
    `;
  }).join("");

  $$("[data-author-filter]", list).forEach((button) => {
    button.addEventListener("click", () => {
      state.archiveDetailAuthor = button.dataset.authorFilter || "";
      $("#archiveAuthor").value = "";
      refreshArchive();
    });
  });
  $$("[data-copy-path]", list).forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyPath || ""));
  });
}

function renderArchiveItems(list) {
  list.className = "archive-list";
  const items = state.archive.items || [];
  $("#deleteArchiveBtn").disabled = state.selectedArchive.size === 0;
  if (!items.length) {
    list.innerHTML = `
      <div class="surface-panel placeholder-panel">
        <div class="placeholder-mark">▤</div>
        <h2>暂无作品</h2>
        <p>当前筛选条件下没有这个作者的下载记录。</p>
        <div class="button-cluster">
          <button class="ghost-button" type="button" data-close-archive-author>返回作者</button>
        </div>
      </div>
    `;
    bindArchiveBackButtons();
    return;
  }

  list.innerHTML = `
    <section class="surface-panel archive-detail-head">
      <button class="ghost-button compact" type="button" data-close-archive-author>返回作者</button>
      <div>
        <h2>${escapeHtml(state.archiveDetailAuthor || "作者作品")}</h2>
        <p>${Number(state.archive.total || 0)} 个作品</p>
      </div>
    </section>
  ` + items.map((item) => {
    const cover = Array.isArray(item.cover_urls) && item.cover_urls[0]
      ? `<img src="${escapeAttr(item.cover_urls[0])}" alt="" referrerpolicy="no-referrer" />`
      : typeText(item.aweme_type).slice(0, 2);
    const checked = state.selectedArchive.has(item.aweme_id);
    const copyPath = item.copy_path || item.file_path || "";
    return `
      <article class="archive-item">
        <label class="mini-toggle"><input type="checkbox" ${checked ? "checked" : ""} data-archive-select="${escapeAttr(item.aweme_id)}" /></label>
        <div class="cover-tile">${cover}</div>
        <div>
          <div class="archive-title">${escapeHtml(item.title || item.aweme_id)}</div>
          <div class="archive-subtitle">${escapeHtml(item.author_name || "未知作者")} · ${escapeHtml(formatTime(item.download_time))}</div>
          <div class="card-meta">
            <span class="pill">${escapeHtml(typeText(item.aweme_type))}</span>
            <span class="pill">${escapeHtml(item.aweme_id)}</span>
            ${copyPath ? `<span class="pill">${escapeHtml(copyPath)}</span>` : ""}
          </div>
        </div>
        <div class="archive-actions">
          <button class="ghost-button compact" type="button" data-copy-path="${escapeAttr(copyPath)}">复制路径</button>
        </div>
      </article>
    `;
  }).join("");

  bindArchiveBackButtons();
  $$("[data-archive-select]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedArchive.add(input.dataset.archiveSelect);
      else state.selectedArchive.delete(input.dataset.archiveSelect);
      $("#deleteArchiveBtn").disabled = state.selectedArchive.size === 0;
    });
  });
  $$("[data-copy-path]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copyPath || ""));
  });
}

function bindArchiveBackButtons() {
  $$("[data-close-archive-author]").forEach((button) => {
    button.addEventListener("click", () => {
      state.archiveDetailAuthor = "";
      state.selectedArchive.clear();
      refreshArchive();
    });
  });
}

async function deleteArchiveItems() {
  const ids = Array.from(state.selectedArchive);
  if (!ids.length) return;
  try {
    const result = await api("/archive", {
      method: "DELETE",
      body: JSON.stringify({ aweme_ids: ids }),
    });
    toast(`已删除 ${result.deleted || 0} 条记录`);
    await refreshArchive();
  } catch (error) {
    toast(`删除失败：${error.message}`, "error");
  }
}

function fillSettingsForm() {
  const cfg = state.config;
  if (!cfg) return;
  $("#settingDataDir").value = cfg.data_dir || "./data/";
  $("#settingPath").value = cfg.download_path || "";
  $("#settingAuthorDir").value = cfg.naming?.author_dir || "nickname";
  $("#settingFilenameTemplate").value = cfg.naming?.filename_template || "{date}_{title}_{id}";
  $("#settingFolderTemplate").value = cfg.naming?.folder_template || "{date}_{title}_{id}";
  $("#settingFolderstyle").checked = Boolean(cfg.naming?.folderstyle);
  $("#settingGroupByMode").checked = Boolean(cfg.naming?.group_by_mode);
  $("#settingThread").value = cfg.thread || 5;
  $("#settingRateLimit").value = cfg.rate_limit || 2;
  $("#settingRetryTimes").value = cfg.retry_times || 3;
  $("#settingProxy").value = cfg.proxy || "";
  $("#settingMusic").checked = Boolean(cfg.media?.music);
  $("#settingCover").checked = Boolean(cfg.media?.cover);
  $("#settingAvatar").checked = Boolean(cfg.media?.avatar);
  $("#settingJson").checked = Boolean(cfg.media?.json);
  $("#settingCommentsEnabled").checked = Boolean(cfg.comments?.enabled);
  $("#settingCommentsReplies").checked = Boolean(cfg.comments?.include_replies);
  $("#settingMaxComments").value = cfg.comments?.max_comments ?? 0;
  $("#settingLiveMaxDuration").value = cfg.live?.max_duration_seconds ?? 0;
  $("#settingLiveIdleTimeout").value = cfg.live?.idle_timeout_seconds ?? 30;
  $("#settingLiveConvertToMp4").checked = cfg.live?.convert_to_mp4 !== false;
  $("#settingLiveKeepSourceFlv").checked = cfg.live?.keep_source_flv !== false;
  fillQuickLiveFormFromConfig();
  fillLiveFormFromConfig();
}

async function saveSettings() {
  const payload = {
    data_dir: $("#settingDataDir").value.trim(),
    path: $("#settingPath").value.trim(),
    author_dir: $("#settingAuthorDir").value,
    filename_template: $("#settingFilenameTemplate").value.trim(),
    folder_template: $("#settingFolderTemplate").value.trim(),
    folderstyle: $("#settingFolderstyle").checked,
    group_by_mode: $("#settingGroupByMode").checked,
    thread: Number($("#settingThread").value || 5),
    rate_limit: Number($("#settingRateLimit").value || 2),
    retry_times: Number($("#settingRetryTimes").value || 3),
    proxy: $("#settingProxy").value.trim(),
    music: $("#settingMusic").checked,
    cover: $("#settingCover").checked,
    avatar: $("#settingAvatar").checked,
    json: $("#settingJson").checked,
    comments: {
      enabled: $("#settingCommentsEnabled").checked,
      include_replies: $("#settingCommentsReplies").checked,
      max_comments: Number($("#settingMaxComments").value || 0),
    },
    live: {
      max_duration_seconds: Number($("#settingLiveMaxDuration").value || 0),
      idle_timeout_seconds: Number($("#settingLiveIdleTimeout").value || 30),
      convert_to_mp4: $("#settingLiveConvertToMp4").checked,
      keep_source_flv: $("#settingLiveKeepSourceFlv").checked,
    },
  };
  $("#saveSettingsBtn").disabled = true;
  try {
    const result = await api("/config", { method: "PATCH", body: JSON.stringify(payload) });
    state.config = result.config;
    $("#settingsSaveState").textContent = result.saved ? "已保存到配置文件" : "已应用到当前进程";
    renderAccountState();
    toast("设置已保存");
  } catch (error) {
    toast(`保存失败：${error.message}`, "error");
  } finally {
    $("#saveSettingsBtn").disabled = false;
  }
}

async function verifyAccount({ silent = false } = {}) {
  const cookies = state.config?.cookies || {};
  if (!cookies.session_present) {
    state.account = { verified: false, profile: null, verifying: false, error: "" };
    renderAccountState();
    return null;
  }
  state.account.verifying = true;
  state.account.error = "";
  renderAccountState();
  try {
    const result = await api("/account?fetch=true");
    state.account = {
      verified: true,
      profile: result.profile || null,
      verifying: false,
      error: "",
    };
    if (state.config?.cookies) state.config.cookies.verified = true;
    renderAccountState();
    return result;
  } catch (error) {
    state.account = {
      verified: false,
      profile: null,
      verifying: false,
      error: error.message,
    };
    renderAccountState();
    if (!silent) toast(`账号验证失败：${error.message}`, "error");
    return null;
  }
}

function renderLoginStatus(login) {
  const status = login?.status || "idle";
  const running = status === "running";
  $("#startLoginBtn").disabled = running;
  $("#cancelLoginBtn").disabled = !running;
  const cookieText = Number(login?.cookie_count || 0)
    ? `已捕获 ${Number(login.cookie_count || 0)} 项 Cookie`
    : "暂未捕获登录 Cookie";
  const missing = Array.isArray(login?.missing_required) && login.missing_required.length
    ? `；缺少 ${login.missing_required.join(", ")}`
    : "";
  const text = {
    idle: "点击“一键登录抖音”后，会打开抖音网页；你完成登录时后台会自动提取 Cookie。",
    running: `${login.message || "等待抖音登录完成"}；${cookieText}${missing}`,
    success: `登录成功，Cookie 已保存到 ${login.saved_cookie_file || "本地文件"}`,
    failed: `登录失败：${login.error || login.message || "未知错误"}`,
    cancelled: "登录已取消",
  }[status] || (login?.message || "登录状态未知");
  $("#loginProgress").textContent = text;
  $("#loginProgress").classList.toggle("muted", status !== "success" && status !== "failed");
}

function startLoginPolling() {
  if (state.loginPollTimer) clearInterval(state.loginPollTimer);
  const poll = async () => {
    try {
      const status = await api("/login/status");
      renderLoginStatus(status);
      if (["success", "failed", "cancelled"].includes(status.status)) {
        clearInterval(state.loginPollTimer);
        state.loginPollTimer = null;
        if (status.status === "success") {
          await refreshConfig();
          await verifyAccount({ silent: false });
          toast("登录 Cookie 已保存");
        }
      }
    } catch (error) {
      clearInterval(state.loginPollTimer);
      state.loginPollTimer = null;
      toast(`读取登录状态失败：${error.message}`, "error");
    }
  };
  state.loginPollTimer = setInterval(poll, 1000);
  poll();
}

async function startLogin() {
  try {
    const status = await api("/login/start", {
      method: "POST",
      body: JSON.stringify({ timeout_seconds: 300 }),
    });
    renderLoginStatus(status);
    startLoginPolling();
    toast("已打开抖音登录窗口");
  } catch (error) {
    renderLoginStatus({ status: "failed", error: error.message });
    toast(`启动登录失败：${error.message}`, "error");
  }
}

async function cancelLogin() {
  try {
    const status = await api("/login", { method: "DELETE" });
    renderLoginStatus(status);
    if (state.loginPollTimer) {
      clearInterval(state.loginPollTimer);
      state.loginPollTimer = null;
    }
  } catch (error) {
    toast(`停止登录失败：${error.message}`, "error");
  }
}

async function clearCookies() {
  try {
    const result = await api("/cookies/clear", { method: "POST" });
    state.config = result.config;
    state.account = { verified: false, profile: null, verifying: false, error: "" };
    renderAccountState();
    toast("登录态已清除");
  } catch (error) {
    toast(`清除失败：${error.message}`, "error");
  }
}

async function copyText(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制");
  } catch {
    toast(value);
  }
}

function showView(view) {
  const meta = VIEW_META[view] || VIEW_META.download;
  state.view = view;
  $$(".view").forEach((node) => node.classList.toggle("active-view", node.id === `${view}View`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#viewTitle").textContent = meta.title;
  $("#viewEyebrow").textContent = meta.eyebrow;

  if (view === "archive") refreshArchive();
  if (view === "preview") renderPreview();
  if (view === "live") {
    fillLiveFormFromConfig();
    renderLiveStatus();
  }
  if (view === "tasks") refreshJobs();
  if (view === "following") {
    if (!state.following.length) syncFollowing();
    else renderFollowing();
  }
  if (view === "collections") {
    if (!state.collections.folders.length && !state.collections.mixes.length) syncCollections();
    else if (state.collectionWorks.visible) renderCollectionWorks();
    else renderCollections();
  }
  if (view === "settings") fillSettingsForm();
}

async function refreshCurrentView() {
  try {
    setHealth(true, "已连接");
    if (state.view === "archive") await refreshArchive();
    else if (state.view === "tasks") await refreshJobs();
    else if (state.view === "collections" && state.collectionWorks.visible) await loadCollectionWorks({ reset: true });
    else if (state.view === "collections") await syncCollections();
    else if (state.view === "preview" && state.authorWorks.visible) await loadAuthorWorks({ reset: true });
    else if (state.view === "preview") renderPreview();
    else if (state.view === "live") {
      await refreshJobs();
      renderLiveStatus();
    }
    else if (state.view === "following" && state.authorWorks.visible) await loadAuthorWorks({ reset: true });
    else if (state.view === "following") await syncFollowing();
    else {
      await refreshConfig();
      await refreshJobs();
    }
  } catch (error) {
    setHealth(false, "连接失败");
    toast(`刷新失败：${error.message}`, "error");
  }
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-jump-view]");
    if (jump) showView(jump.dataset.jumpView);
  });
  $("#manageAccountBtn").addEventListener("click", () => showView("settings"));
  $("#refreshBtn").addEventListener("click", refreshCurrentView);
  $("#urlInput").addEventListener("input", () => {
    state.parsed = null;
    $("#parseBadge").textContent = "待检测";
    $("#parseResult").classList.add("muted");
    $("#parseResult").textContent = "等待输入";
    renderDownloadLiveOptions(false);
  });
  $("#parseBtn").addEventListener("click", parseUrl);
  $("#startDownloadBtn").addEventListener("click", startDownload);
  const selectDefaultModesBtn = $("#selectDefaultModesBtn");
  if (selectDefaultModesBtn) {
    selectDefaultModesBtn.addEventListener("click", () => {
      state.selectedModes = new Set(["post"]);
      renderModes();
    });
  }
  $("#resolveAuthorBtn").addEventListener("click", resolvePreviewAuthor);
  $("#startBatchBtn").addEventListener("click", startBatch);
  $("#startLiveBtn").addEventListener("click", startLiveRecording);
  $("#stopLiveBtn").addEventListener("click", stopLiveRecording);
  $("#cancelActiveJobBtn").addEventListener("click", cancelActiveJob);
  $("#clearDoneJobsBtn").addEventListener("click", clearDoneJobs);
  $("#taskSearch").addEventListener("input", renderTasks);
  $("#taskTabs").addEventListener("click", (event) => {
    const target = event.target.closest("[data-status]");
    if (!target) return;
    state.taskFilter = target.dataset.status;
    $$("#taskTabs button").forEach((button) => button.classList.toggle("active", button === target));
    renderTasks();
  });
  $("#syncFollowingBtn").addEventListener("click", syncFollowing);
  $("#followSearch").addEventListener("input", () => renderFollowing());
  $("#followSort").addEventListener("change", () => renderFollowing());
  $$("[data-follow-layout]").forEach((button) => {
    button.addEventListener("click", () => {
      state.followLayout = button.dataset.followLayout;
      $$("[data-follow-layout]").forEach((item) => item.classList.toggle("active", item === button));
      renderFollowing();
    });
  });
  $("#downloadSelectedFollowBtn").addEventListener("click", () => downloadUsers(Array.from(state.selectedFollowing)));
  $("#closeAuthorWorksBtn").addEventListener("click", () => {
    closeAuthorWorks();
    renderFollowing();
  });
  $("#workModeTabs").addEventListener("click", (event) => {
    const target = event.target.closest("[data-work-mode]");
    if (!target) return;
    state.authorWorks.mode = target.dataset.workMode;
    $$("#workModeTabs button").forEach((button) => button.classList.toggle("active", button === target));
    loadAuthorWorks({ reset: true });
  });
  $("#workSearch").addEventListener("input", renderAuthorWorks);
  $("#workTypeFilter").addEventListener("change", renderAuthorWorks);
  $("#workSort").addEventListener("change", renderAuthorWorks);
  $("#workDateFrom").addEventListener("change", renderAuthorWorks);
  $("#workDateTo").addEventListener("change", renderAuthorWorks);
  $("#loadMoreWorksBtn").addEventListener("click", () => loadAuthorWorks({ reset: false }));
  $("#downloadSelectedWorksBtn").addEventListener("click", downloadSelectedWorks);
  $("#syncCollectionsBtn").addEventListener("click", syncCollections);
  $("#collectionSearch").addEventListener("input", () => renderCollections());
  $("#collectionTabs").addEventListener("click", (event) => {
    const target = event.target.closest("[data-collection-type]");
    if (!target) return;
    state.collectionFilter = target.dataset.collectionType;
    $$("#collectionTabs button").forEach((button) => button.classList.toggle("active", button === target));
    renderCollections();
  });
  $("#closeCollectionWorksBtn").addEventListener("click", () => {
    closeCollectionWorks();
    renderCollections();
  });
  $("#collectionWorkSearch").addEventListener("input", renderCollectionWorks);
  $("#collectionWorkTypeFilter").addEventListener("change", renderCollectionWorks);
  $("#collectionWorkSort").addEventListener("change", renderCollectionWorks);
  $("#collectionWorkDateFrom").addEventListener("change", renderCollectionWorks);
  $("#collectionWorkDateTo").addEventListener("change", renderCollectionWorks);
  $("#loadMoreCollectionWorksBtn").addEventListener("click", () => loadCollectionWorks({ reset: false }));
  $("#downloadSelectedCollectionWorksBtn").addEventListener("click", downloadSelectedCollectionWorks);
  $("#downloadAllCollectionsBtn").addEventListener("click", () => downloadAllCollections("folder"));
  $("#downloadAllCollectMixBtn").addEventListener("click", () => downloadAllCollections("mix"));
  $("#applyArchiveFilterBtn").addEventListener("click", refreshArchive);
  $("#deleteArchiveBtn").addEventListener("click", deleteArchiveItems);
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#startLoginBtn").addEventListener("click", startLogin);
  $("#cancelLoginBtn").addEventListener("click", cancelLogin);
  $("#clearCookiesBtn").addEventListener("click", clearCookies);
}

async function boot() {
  bindEvents();
  try {
    await api("/health");
    setHealth(true, "已连接");
    await refreshConfig();
    const login = await api("/login/status");
    renderLoginStatus(login);
    if (login.status === "running") startLoginPolling();
    await refreshJobs();
    renderPreview();
    renderLiveStatus();
    renderFollowing();
    renderCollections();
  } catch (error) {
    setHealth(false, "连接失败");
    toast(`启动失败：${error.message}`, "error");
  }
  setInterval(() => {
    refreshJobs().catch(() => undefined);
  }, 3000);
}

document.addEventListener("DOMContentLoaded", boot);
