import { api, extractContentId, extractUrl, extractUrls } from "./api.js?v=20260707-8";
import { createInitialState } from "./store.js?v=20260707-8";
import AppShell from "./components/AppShell.js?v=20260707-8";

const { createApp, reactive } = Vue;

const state = reactive(createInitialState());
let refreshTimer = null;
let archiveRefreshTimer = null;
let lastArchiveJobSignature = "";
let worksLoadToken = 0;

function showToast(message) {
  state.ui.toast = String(message || "");
  if (state.ui.toast) {
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => {
      state.ui.toast = "";
    }, 3600);
  }
}

function liveDefaultsFromConfig() {
  const live = state.config?.live || {};
  return {
    max_duration_seconds: Number(live.max_duration_seconds ?? 0),
    idle_timeout_seconds: Number(live.idle_timeout_seconds ?? 30),
    convert_to_mp4: live.convert_to_mp4 !== false,
    keep_source_flv: live.keep_source_flv !== false,
  };
}

function accountDetail(profile) {
  if (!profile) return "";
  const parts = [];
  if (profile.unique_id) parts.push(`抖音号 ${profile.unique_id}`);
  else if (profile.short_id) parts.push(`抖音号 ${profile.short_id}`);
  else if (profile.uid) parts.push(`UID ${profile.uid}`);
  return parts.join(" · ");
}

function setAccountState(patch) {
  Object.assign(state.account, patch);
}

function syncFormsFromConfig() {
  const cfg = state.config;
  if (!cfg) return;
  const liveDefaults = liveDefaultsFromConfig();
  Object.assign(state.forms.video.live, liveDefaults);
  Object.assign(state.forms.live, { url: state.forms.live.url || "", ...liveDefaults });
  Object.assign(state.forms.settings, {
    data_dir: cfg.data_dir || "./data/",
    path: cfg.download_path || "",
    author_dir: cfg.naming?.author_dir || "nickname",
    filename_template: cfg.naming?.filename_template || "{date}_{title}_{id}",
    folder_template: cfg.naming?.folder_template || "{date}_{title}_{id}",
    thread: Number(cfg.thread || 5),
    rate_limit: Number(cfg.rate_limit || 2),
    retry_times: Number(cfg.retry_times || 3),
    proxy: cfg.proxy || "",
    music: Boolean(cfg.media?.music),
    cover: Boolean(cfg.media?.cover),
    avatar: Boolean(cfg.media?.avatar),
    json: Boolean(cfg.media?.json),
    save_desc: Boolean(cfg.media?.save_desc),
    comments_enabled: Boolean(cfg.comments?.enabled),
    comments_include_replies: Boolean(cfg.comments?.include_replies),
    comments_max: Number(cfg.comments?.max_comments || 0),
    comments_page_size: Number(cfg.comments?.page_size || 20),
    live_max_duration: liveDefaults.max_duration_seconds,
    live_idle_timeout: liveDefaults.idle_timeout_seconds,
    live_convert_to_mp4: liveDefaults.convert_to_mp4,
    live_keep_source_flv: liveDefaults.keep_source_flv,
  });
  const cookies = cfg.cookies || {};
  const hasSession = Boolean(cookies.auth_ready || cookies.session_present || cookies.verified);
  if (!hasSession) {
    setAccountState({ label: "未登录", detail: "", ok: false, profile: null, error: "" });
  } else if (!state.account.ok) {
    setAccountState({ label: "已登录", detail: "Cookie 待验证", ok: true, error: "" });
  }
}

async function refreshConfig() {
  const cfg = await api("/config");
  state.config = cfg;
  syncFormsFromConfig();
}

async function refreshHealth() {
  try {
    await api("/health");
    state.health = { ok: true, label: "已连接" };
  } catch (_error) {
    state.health = { ok: false, label: "连接失败" };
  }
}

async function refreshAccount({ silent = true } = {}) {
  const cookies = state.config?.cookies || {};
  const hasSession = Boolean(cookies.auth_ready || cookies.session_present || cookies.verified);
  if (!hasSession) {
    setAccountState({ label: "未登录", detail: "", ok: false, verifying: false, profile: null, error: "" });
    return null;
  }
  setAccountState({ verifying: true, error: "" });
  try {
    const result = await api("/account?fetch=true");
    const profile = result.profile || null;
    setAccountState({
      label: profile?.nickname || "已登录",
      detail: accountDetail(profile) || "账号已验证",
      ok: true,
      verifying: false,
      profile,
      error: "",
    });
    if (state.config?.cookies) state.config.cookies.verified = true;
    return profile;
  } catch (error) {
    setAccountState({
      label: "Cookie 待验证",
      detail: "请在设置中重新登录",
      ok: false,
      verifying: false,
      error: error.message || String(error),
    });
    if (!silent) throw error;
    return null;
  }
}

async function refreshJobs() {
  const result = await api("/jobs");
  state.jobs = result.jobs || [];
  if (!state.selectedJobId && state.jobs.length) {
    state.selectedJobId = state.jobs[0].job_id;
  }
  const signature = archiveJobSignature(state.jobs);
  if (state.currentView === "library" && signature && signature !== lastArchiveJobSignature) {
    scheduleLibraryRefresh();
  }
  lastArchiveJobSignature = signature;
}

async function refreshArchive() {
  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("size", "100");
  if (state.archiveFilters.author) params.set("author", state.archiveFilters.author);
  if (state.archiveFilters.title) params.set("title", state.archiveFilters.title);
  if (state.archiveFilters.aweme_type) params.set("aweme_type", state.archiveFilters.aweme_type);
  const result = await api(`/archive?${params.toString()}`);
  state.archive = { total: Number(result.total || 0), items: result.items || [] };
  return state.archive;
}

async function refreshArchiveAuthors() {
  const params = new URLSearchParams();
  if (state.archiveFilters.title) params.set("title", state.archiveFilters.title);
  if (state.archiveFilters.aweme_type) params.set("aweme_type", state.archiveFilters.aweme_type);
  const suffix = params.toString();
  const result = await api(`/archive/authors${suffix ? `?${suffix}` : ""}`);
  state.archiveAuthors = { total: Number(result.total || 0), items: result.items || [] };
  return state.archiveAuthors;
}

async function refreshLibrary() {
  await Promise.all([refreshArchive(), refreshArchiveAuthors()]);
}

function archiveJobSignature(jobs) {
  return (jobs || [])
    .filter((job) => ["success", "failed", "cancelled"].includes(job.status))
    .map((job) => `${job.job_id}:${job.status}:${job.success}:${job.failed}:${job.updated_at || ""}`)
    .sort()
    .join("|");
}

function scheduleLibraryRefresh() {
  window.clearTimeout(archiveRefreshTimer);
  archiveRefreshTimer = window.setTimeout(() => {
    refreshLibrary().catch(() => {});
  }, 350);
}

function selectedLiveOverrides(source) {
  return {
    live: {
      max_duration_seconds: Math.max(0, Number(source.max_duration_seconds || 0)),
      idle_timeout_seconds: Math.max(1, Number(source.idle_timeout_seconds || 30)),
      convert_to_mp4: source.convert_to_mp4 !== false,
      keep_source_flv: source.keep_source_flv !== false,
    },
  };
}

async function parseVideoUrl() {
  const raw = state.forms.video.url.trim();
  if (!raw) {
    showToast("请输入链接或分享文案");
    return null;
  }
  state.forms.video.parseStatus = "检测中";
  const result = await api("/parse", { method: "POST", body: JSON.stringify({ url: raw }) });
  state.forms.video.parseResult = result;
  if (result.url) state.forms.video.url = result.url;
  state.forms.video.parseStatus = result.supported ? "可下载" : "未支持";
  return result;
}

async function createDownload() {
  let parsed = state.forms.video.parseResult;
  if (!parsed) parsed = await parseVideoUrl();
  if (!parsed?.supported) {
    showToast("当前链接未识别为可下载内容");
    return;
  }
  const url = parsed.url || extractUrl(state.forms.video.url);
  const isLive = parsed.parsed?.type === "live";
  const payload = {
    url,
    ...(isLive ? selectedLiveOverrides(state.forms.video.live) : {}),
  };
  const job = await api("/download", { method: "POST", body: JSON.stringify(payload) });
  state.selectedJobId = job.job_id;
  showToast(`任务已创建：${job.job_id}`);
  await refreshJobs();
}

async function createBatch() {
  const raw = state.forms.batch.text;
  const urls = extractUrls(raw).length
    ? extractUrls(raw)
    : raw.split(/\r?\n/).map((line) => extractUrl(line)).filter(Boolean);
  if (!urls.length) {
    showToast("请输入批量链接");
    return;
  }
  let ok = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      await api("/download", { method: "POST", body: JSON.stringify({ url }) });
      ok += 1;
    } catch (_error) {
      failed += 1;
    }
  }
  state.forms.batch.text = urls.join("\n");
  state.forms.batch.result = `已创建 ${ok} 个任务，失败 ${failed} 个`;
  showToast(state.forms.batch.result);
  await refreshJobs();
}

async function createLive() {
  const raw = state.forms.live.url.trim();
  if (!raw) {
    showToast("请输入直播链接");
    return;
  }
  const url = extractUrl(raw);
  const job = await api("/download", {
    method: "POST",
    body: JSON.stringify({ url, ...selectedLiveOverrides(state.forms.live) }),
  });
  state.selectedJobId = job.job_id;
  showToast(`直播录制任务已创建：${job.job_id}`);
  await refreshJobs();
}

async function cancelJob(jobId) {
  if (!jobId) return;
  await api(`/jobs/${jobId}`, { method: "DELETE" });
  showToast("任务已停止或删除");
  await refreshJobs();
}

async function clearDone() {
  const result = await api("/jobs", { method: "DELETE" });
  showToast(`已清理 ${result.deleted || 0} 个完成任务`);
  await refreshJobs();
}

async function saveSettings() {
  const form = state.forms.settings;
  const payload = {
    data_dir: form.data_dir,
    path: form.path,
    author_dir: form.author_dir,
    filename_template: form.filename_template,
    folder_template: form.folder_template,
    thread: Number(form.thread || 5),
    rate_limit: Number(form.rate_limit || 2),
    retry_times: Number(form.retry_times || 3),
    proxy: form.proxy || "",
    music: Boolean(form.music),
    cover: Boolean(form.cover),
    avatar: Boolean(form.avatar),
    json: Boolean(form.json),
    save_desc: Boolean(form.save_desc),
    comments: {
      enabled: Boolean(form.comments_enabled),
      include_replies: Boolean(form.comments_include_replies),
      max_comments: Math.max(0, Number(form.comments_max || 0)),
      page_size: Math.max(1, Number(form.comments_page_size || 20)),
    },
    live: {
      max_duration_seconds: Number(form.live_max_duration || 0),
      idle_timeout_seconds: Number(form.live_idle_timeout || 30),
      convert_to_mp4: Boolean(form.live_convert_to_mp4),
      keep_source_flv: Boolean(form.live_keep_source_flv),
    },
  };
  const result = await api("/config", { method: "PATCH", body: JSON.stringify(payload) });
  state.config = result.config;
  syncFormsFromConfig();
  showToast("设置已保存");
}

async function startLogin() {
  await api("/login/start", { method: "POST", body: JSON.stringify({ timeout_seconds: 300 }) });
  showToast("已打开登录窗口，登录后会自动提取 Cookie");
}

async function clearCookies() {
  const result = await api("/cookies/clear", { method: "POST" });
  state.config = result.config;
  syncFormsFromConfig();
  setAccountState({ label: "未登录", detail: "", ok: false, verifying: false, profile: null, error: "" });
  showToast("登录状态已清除");
}

async function syncFollowing() {
  const following = state.sources.following;
  if (following.syncing) return;
  following.syncing = true;
  following.error = "";
  try {
    const result = await api("/following/sync", { method: "POST", body: JSON.stringify({ limit: 80 }) });
    following.items = result.items || [];
    following.selected = [];
    following.autoSynced = true;
    showToast(`关注同步已完成：${following.items.length} 个账号`);
  } catch (error) {
    following.error = error.message || String(error);
    throw error;
  } finally {
    following.syncing = false;
  }
}

async function syncCollections() {
  const collections = state.sources.collections;
  if (collections.syncing) return;
  collections.syncing = true;
  collections.error = "";
  try {
    const result = await api("/collections/sync", { method: "POST", body: JSON.stringify({ limit: 120 }) });
    collections.folders = result.folders || [];
    collections.mixes = result.mixes || [];
    collections.autoSynced = true;
    showToast(`收藏同步已完成：${collections.folders.length} 个收藏夹，${collections.mixes.length} 个收藏合集`);
  } catch (error) {
    collections.error = error.message || String(error);
    throw error;
  } finally {
    collections.syncing = false;
  }
}

function workKey(item) {
  return `${item?.type || "item"}:${item?.id || ""}`;
}

function toggleArrayItem(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

function resetWorks({ source, subject, mode = "post", title = "" }) {
  const works = state.sources.works;
  Object.assign(works, {
    visible: true,
    source,
    subject,
    mode,
    title,
    items: [],
    selected: [],
    query: "",
    type: "",
    sort: "new",
    cursor: 0,
    hasMore: false,
    loading: false,
    error: "",
  });
}

async function resolveAuthor() {
  const author = state.sources.author;
  const raw = author.url.trim();
  if (!raw) {
    showToast("请输入作者主页链接或分享主页文案");
    return null;
  }
  author.resolving = true;
  author.error = "";
  try {
    const result = await api("/author/resolve", { method: "POST", body: JSON.stringify({ url: raw }) });
    author.profile = result.profile || { sec_uid: result.sec_uid, nickname: result.sec_uid };
    if (result.url) author.url = result.url;
    showToast("作者主页解析完成");
    return author.profile;
  } catch (error) {
    author.error = error.message || String(error);
    throw error;
  } finally {
    author.resolving = false;
  }
}

function updateKnownAuthor(author, patch) {
  if (!author?.sec_uid) return;
  const mergeInto = (item) => {
    if (item?.sec_uid === author.sec_uid) Object.assign(item, patch);
  };
  state.sources.following.items.forEach(mergeInto);
  if (state.sources.author.profile?.sec_uid === author.sec_uid) {
    state.sources.author.profile = { ...state.sources.author.profile, ...patch };
  }
  if (state.sources.works.subject?.sec_uid === author.sec_uid) {
    state.sources.works.subject = { ...state.sources.works.subject, ...patch };
  }
}

function updateKnownCollection(collection, patch) {
  if (!collection?.id || !collection?.type) return;
  const list = collection.type === "folder" ? state.sources.collections.folders : state.sources.collections.mixes;
  list.forEach((item) => {
    if (String(item.id) === String(collection.id)) Object.assign(item, patch);
  });
  if (
    state.sources.works.subject?.type === collection.type
    && String(state.sources.works.subject?.id) === String(collection.id)
  ) {
    state.sources.works.subject = { ...state.sources.works.subject, ...patch };
  }
}

async function openAuthorWorks(payload = {}) {
  let author = payload.author || state.sources.author.profile;
  if (!author?.sec_uid) {
    author = await resolveAuthor();
  }
  if (!author?.sec_uid) return;
  const mode = payload.mode || "post";
  const works = state.sources.works;
  const sameWorks =
    works.visible
    && works.source === "author"
    && works.subject?.sec_uid === author.sec_uid
    && works.mode === mode;
  if (sameWorks && (works.loading || (!works.error && works.items.length))) return;
  resetWorks({
    source: "author",
    subject: author,
    mode,
    title: `${author.nickname || author.sec_uid} · ${modeLabel(mode)}`,
  });
  works.loading = true;
  scheduleWorksLoad(() => loadAuthorWorks({ reset: true, force: true }));
}

function modeLabel(mode) {
  return (
    {
      post: "作品",
      like: "喜欢",
      mix: "合集",
      music: "音乐",
    }[mode] || "作品"
  );
}

async function loadAuthorWorks({ reset = false, force = false } = {}) {
  const works = state.sources.works;
  const author = works.subject;
  if (!author?.sec_uid || (works.loading && !force)) return;
  if (reset) {
    works.items = [];
    works.selected = [];
    works.cursor = 0;
    works.hasMore = false;
    works.error = "";
  }
  works.loading = true;
  try {
    const params = new URLSearchParams({
      mode: works.mode,
      cursor: String(reset ? 0 : works.cursor || 0),
      count: "24",
    });
    const result = await api(`/users/${encodeURIComponent(author.sec_uid)}/works?${params.toString()}`);
    if (result.profile) {
      works.subject = { ...author, ...result.profile };
      updateKnownAuthor(author, result.profile);
      if (state.sources.author.profile?.sec_uid === author.sec_uid) {
        state.sources.author.profile = { ...state.sources.author.profile, ...result.profile };
      }
    }
    mergeWorks(result.items || []);
    const loadedCount = works.items.length;
    const reportedCount = Number(works.subject?.aweme_count || 0);
    if (works.mode === "post" && loadedCount > reportedCount) {
      updateKnownAuthor(author, { aweme_count: loadedCount });
    }
    works.cursor = Number(result.cursor || 0);
    works.hasMore = Boolean(result.has_more) && works.cursor > 0;
    works.title = `${works.subject?.nickname || author.sec_uid} · ${modeLabel(works.mode)}`;
  } catch (error) {
    works.error = error.message || String(error);
    throw error;
  } finally {
    works.loading = false;
  }
}

function mergeWorks(items) {
  const works = state.sources.works;
  const seen = new Set(works.items.map(workKey));
  for (const item of items) {
    const key = workKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      works.items.push(item);
    }
  }
}

async function setWorkMode(mode) {
  const works = state.sources.works;
  if (works.source !== "author" || works.mode === mode) return;
  works.mode = mode;
  works.title = `${works.subject?.nickname || "作者"} · ${modeLabel(mode)}`;
  await loadAuthorWorks({ reset: true });
}

async function openCollectionWorks(item) {
  if (!item?.id || !item?.type) return;
  const works = state.sources.works;
  const sameWorks =
    works.visible
    && works.source === "collection"
    && works.subject?.type === item.type
    && String(works.subject?.id) === String(item.id);
  if (sameWorks && (works.loading || (!works.error && works.items.length))) return;
  resetWorks({
    source: "collection",
    subject: item,
    mode: "collection",
    title: `${item.title || item.id} · 作品`,
  });
  works.loading = true;
  scheduleWorksLoad(() => loadCollectionWorks({ reset: true, force: true }));
}

async function loadCollectionWorks({ reset = false, force = false } = {}) {
  const works = state.sources.works;
  const collection = works.subject;
  if (!collection?.id || !collection?.type || (works.loading && !force)) return;
  if (reset) {
    works.items = [];
    works.selected = [];
    works.cursor = 0;
    works.hasMore = false;
    works.error = "";
  }
  works.loading = true;
  try {
    const params = new URLSearchParams({
      cursor: String(reset ? 0 : works.cursor || 0),
      count: "24",
    });
    const result = await api(
      `/collections/${encodeURIComponent(collection.type)}/${encodeURIComponent(collection.id)}/works?${params.toString()}`,
    );
    mergeWorks(result.items || []);
    const loadedCount = works.items.length;
    const reportedCount = Number(works.subject?.count || 0);
    if (loadedCount > reportedCount) {
      updateKnownCollection(collection, { count: loadedCount });
    }
    works.cursor = Number(result.cursor || 0);
    works.hasMore = Boolean(result.has_more) && works.cursor > 0;
  } catch (error) {
    works.error = error.message || String(error);
    throw error;
  } finally {
    works.loading = false;
  }
}

function scheduleWorksLoad(loader) {
  const token = ++worksLoadToken;
  window.setTimeout(async () => {
    if (token !== worksLoadToken) return;
    try {
      await loader();
    } catch (error) {
      state.sources.works.error = error.message || String(error);
      showToast(state.sources.works.error);
    }
  }, 0);
}

async function loadMoreWorks() {
  if (state.sources.works.source === "author") {
    await loadAuthorWorks({ reset: false });
  } else if (state.sources.works.source === "collection") {
    await loadCollectionWorks({ reset: false });
  }
}

function closeWorks() {
  state.sources.works.visible = false;
  state.sources.works.items = [];
  state.sources.works.selected = [];
  state.sources.works.error = "";
}

function toggleWork(key) {
  toggleArrayItem(state.sources.works.selected, key);
}

function toggleFollowing(secUid) {
  if (!secUid) return;
  toggleArrayItem(state.sources.following.selected, secUid);
}

async function downloadWorkItems(items) {
  const valid = items.filter((item) => item?.url);
  if (!valid.length) {
    showToast("没有可下载的作品链接");
    return;
  }
  for (const item of valid) {
    await api("/download", { method: "POST", body: JSON.stringify({ url: item.url }) });
  }
  showToast(`已创建 ${valid.length} 个作品下载任务`);
  await refreshJobs();
}

async function downloadSelectedWorks() {
  const selected = new Set(state.sources.works.selected);
  const items = state.sources.works.items.filter((item) => selected.has(workKey(item)));
  await downloadWorkItems(items);
}

async function downloadUser(secUid) {
  if (!secUid) return;
  const mode = state.sources.following.downloadMode || "post";
  await api("/download", {
    method: "POST",
    body: JSON.stringify({ url: `https://www.douyin.com/user/${secUid}`, mode: [mode] }),
  });
  showToast(`已创建 ${modeLabel(mode)}下载任务`);
  await refreshJobs();
}

async function downloadSelectedFollowing() {
  const selected = state.sources.following.selected.filter(Boolean);
  if (!selected.length) return;
  for (const secUid of selected) {
    await downloadUser(secUid);
  }
}

async function downloadCollection(item) {
  if (!item?.id) return;
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
  showToast("收藏下载任务已创建");
  await refreshJobs();
}

async function autoSyncSources() {
  if (!state.account.ok) return;
  const jobs = [];
  const following = state.sources.following;
  const collections = state.sources.collections;
  if (!following.autoSynced && !following.items.length && !following.syncing) {
    following.autoSynced = true;
    jobs.push(syncFollowing().catch((error) => {
      following.error = error.message || String(error);
    }));
  }
  if (!collections.autoSynced && !collections.folders.length && !collections.mixes.length && !collections.syncing) {
    collections.autoSynced = true;
    jobs.push(syncCollections().catch((error) => {
      collections.error = error.message || String(error);
    }));
  }
  if (jobs.length) await Promise.allSettled(jobs);
}

function changeView(view) {
  state.currentView = view;
  if (view === "sources") {
    autoSyncSources().catch(() => {});
  } else if (view === "library") {
    refreshLibrary().catch(() => {});
  }
}

function openArchiveDetail(item) {
  state.library.detail = item || null;
}

function jobMatchesArchive(job, item) {
  if (!job || !item) return false;
  const jobText = `${job.url || ""} ${job.detail || ""} ${job.author_nickname || ""}`.toLowerCase();
  const contentId = extractContentId(job.url) || extractContentId(job.detail);
  if (contentId && String(item.aweme_id || "").includes(contentId)) return true;
  for (const value of [item.aweme_id, item.title, item.author_nickname, item.file_path, item.copy_path]) {
    if (value && jobText.includes(String(value).toLowerCase())) return true;
  }
  return false;
}

async function openJobArchive(job) {
  state.currentView = "library";
  state.library.detail = null;
  if (job?.job_id) {
    const byJob = await api(`/archive?page=1&size=5&job_id=${encodeURIComponent(job.job_id)}`);
    const directMatch = (byJob.items || [])[0];
    if (directMatch) {
      state.archive = { total: Number(byJob.total || 0), items: byJob.items || [] };
      state.library.detail = directMatch;
      refreshArchiveAuthors().catch(() => {});
      showToast("已定位到本地库记录");
      return;
    }
  }
  await refreshLibrary();
  const match = (state.archive.items || []).find((item) => jobMatchesArchive(job, item));
  if (match) {
    state.library.detail = match;
    showToast("已定位到本地库记录");
  } else {
    showToast("未找到对应本地文件，已打开本地库");
  }
}

async function refreshAll() {
  await Promise.allSettled([refreshHealth(), refreshConfig(), refreshJobs(), refreshLibrary()]);
  await refreshAccount({ silent: true });
  if (state.currentView === "sources") {
    await autoSyncSources();
  }
}

const app = createApp({
  components: { AppShell },
  setup() {
    return { state };
  },
  methods: {
    async safeRun(fn) {
      if (state.ui.busy) return;
      state.ui.busy = true;
      try {
        await fn();
      } catch (error) {
        showToast(error.message || String(error));
      } finally {
        state.ui.busy = false;
      }
    },
    refresh: () => refreshAll(),
    changeView: (view) => changeView(view),
    parseUrl: () => parseVideoUrl(),
    createDownload: () => createDownload(),
    createBatch: () => createBatch(),
    createLive: () => createLive(),
    selectJob(jobId) {
      state.selectedJobId = jobId;
    },
    cancelJob: (jobId) => cancelJob(jobId),
    clearDone: () => clearDone(),
    refreshArchive: () => refreshLibrary(),
    archiveFilterChanged: () => refreshLibrary(),
    openArchiveDetail: (item) => openArchiveDetail(item),
    saveSettings: () => saveSettings(),
    login: () => startLogin(),
    clearCookies: () => clearCookies(),
    syncFollowing: () => syncFollowing(),
    syncCollections: () => syncCollections(),
    resolveAuthor: () => resolveAuthor(),
    openAuthorWorks: (payload) => openAuthorWorks(payload),
    openCollectionWorks: (item) => openCollectionWorks(item),
    closeWorks: () => closeWorks(),
    loadMoreWorks: () => loadMoreWorks(),
    setWorkMode: (mode) => setWorkMode(mode),
    toggleWork: (key) => toggleWork(key),
    toggleFollowing: (secUid) => toggleFollowing(secUid),
    downloadSelectedWorks: () => downloadSelectedWorks(),
    downloadWork: (item) => downloadWorkItems([item]),
    downloadUser: (secUid) => downloadUser(secUid),
    downloadSelectedFollowing: () => downloadSelectedFollowing(),
    downloadCollection: (item) => downloadCollection(item),
    cancelSelectedJob(jobId) {
      return this.safeRun(() => cancelJob(jobId));
    },
    openAuthorWorksSafe(payload) {
      return this.safeRun(() => openAuthorWorks(payload));
    },
    openCollectionWorksSafe(item) {
      return this.safeRun(() => openCollectionWorks(item));
    },
    setWorkModeSafe(mode) {
      return this.safeRun(() => setWorkMode(mode));
    },
    downloadWorkSafe(item) {
      return this.safeRun(() => downloadWorkItems([item]));
    },
    downloadUserSafe(secUid) {
      return this.safeRun(() => downloadUser(secUid));
    },
    downloadCollectionSafe(item) {
      return this.safeRun(() => downloadCollection(item));
    },
    openJobArchiveSafe(job) {
      return this.safeRun(() => openJobArchive(job));
    },
  },
  mounted() {
    refreshAll();
    refreshTimer = window.setInterval(() => refreshJobs().catch(() => {}), 2500);
  },
  beforeUnmount() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (archiveRefreshTimer) window.clearTimeout(archiveRefreshTimer);
  },
  template: `
    <AppShell
      :state="state"
      @refresh="safeRun(refresh)"
      @change-view="changeView"
      @parse-url="safeRun(parseUrl)"
      @create-download="safeRun(createDownload)"
      @create-batch="safeRun(createBatch)"
      @create-live="safeRun(createLive)"
      @select-job="selectJob"
      @cancel-job="cancelSelectedJob"
      @clear-done="safeRun(clearDone)"
      @refresh-archive="safeRun(refreshArchive)"
      @archive-filter-changed="safeRun(archiveFilterChanged)"
      @open-archive-detail="openArchiveDetail"
      @open-job-archive="openJobArchiveSafe"
      @save-settings="safeRun(saveSettings)"
      @login="safeRun(login)"
      @clear-cookies="safeRun(clearCookies)"
      @sync-following="safeRun(syncFollowing)"
      @sync-collections="safeRun(syncCollections)"
      @resolve-author="safeRun(resolveAuthor)"
      @open-author-works="openAuthorWorksSafe"
      @open-collection-works="openCollectionWorksSafe"
      @close-works="closeWorks"
      @load-more-works="safeRun(loadMoreWorks)"
      @set-work-mode="setWorkModeSafe"
      @toggle-work="toggleWork"
      @toggle-following="toggleFollowing"
      @download-selected-works="safeRun(downloadSelectedWorks)"
      @download-work="downloadWorkSafe"
      @download-user="downloadUserSafe"
      @download-selected-following="safeRun(downloadSelectedFollowing)"
      @download-collection="downloadCollectionSafe"
    />
    <div v-if="state.ui.toast" class="status-badge" style="position: fixed; right: 24px; bottom: 24px; z-index: 20;">
      {{ state.ui.toast }}
    </div>
  `,
});

app.mount("#app");
