const API_BASE = "/api/v1";

const DOUYIN_URL_RE =
  /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|live\.douyin\.com|v\.iesdouyin\.com|webcast\.amemv\.com)\/[^\s，。；;、]+/i;
const DOUYIN_URL_GLOBAL_RE =
  /https?:\/\/(?:v\.douyin\.com|www\.douyin\.com|live\.douyin\.com|v\.iesdouyin\.com|webcast\.amemv\.com)\/[^\s，。；;、]+/gi;
const GENERIC_URL_RE = /https?:\/\/[^\s，。；;、]+/i;
const GENERIC_URL_GLOBAL_RE = /https?:\/\/[^\s，。；;、]+/gi;

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.detail || data.message || response.statusText);
  }
  return data;
}

export function normalizeExtractedUrl(value) {
  return String(value || "").replace(/[.,!?，。！？]+$/g, "");
}

export function extractUrl(text) {
  const value = String(text || "").trim();
  const match = value.match(DOUYIN_URL_RE) || value.match(GENERIC_URL_RE);
  return match ? normalizeExtractedUrl(match[0]) : value;
}

export function extractUrls(text) {
  const value = String(text || "");
  const matches = value.match(DOUYIN_URL_GLOBAL_RE) || value.match(GENERIC_URL_GLOBAL_RE) || [];
  return matches.map(normalizeExtractedUrl).filter(Boolean);
}

export function statusText(status) {
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

export function typeText(type) {
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

export function typeClass(type) {
  return (
    {
      video: "type-video",
      gallery: "type-gallery",
      note: "type-gallery",
      music: "type-music",
      live: "type-live",
      mix: "type-mix",
      collection: "type-mix",
      folder: "type-folder",
    }[type] || "type-unknown"
  );
}

export function extractContentId(text) {
  const value = String(text || "");
  const explicit = value.match(/(?:video|note|music|collection)\/(\d{8,})/i);
  if (explicit) return explicit[1];
  const live = value.match(/live\.douyin\.com\/(\d{5,})/i);
  if (live) return live[1];
  const longNumber = value.match(/\b\d{12,}\b/);
  return longNumber ? longNumber[0] : "";
}

export function formatTime(value) {
  if (!value) return "未记录";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN");
}

export function formatDate(value) {
  if (!value) return "未记录";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleDateString("zh-CN");
}

export function formatNumber(value) {
  const number = Number(value || 0);
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}w`;
  return String(number);
}

export function downloadStateText(item) {
  const state = item?.download_state || {};
  if (state.status === "available") return "已下载";
  if (state.status === "missing") return "已下载 · 文件已删除";
  return "";
}

export function progressData(job) {
  if (!job) return { value: 0, label: "0%", indeterminate: false };
  const total = Number(job.total || 0);
  const done = Number(job.success || 0) + Number(job.failed || 0) + Number(job.skipped || 0);
  const terminal = ["success", "failed", "cancelled"].includes(job.status);
  if (total > 0) {
    return {
      value: terminal ? 100 : Math.min(99, Math.max(2, Math.round((done / total) * 100))),
      label: `${done}/${total}`,
      indeterminate: !terminal && done === 0,
    };
  }
  if (job.status === "running") return { value: 36, label: job.step || "运行中", indeterminate: true };
  if (job.status === "pending") return { value: 0, label: "等待中", indeterminate: false };
  return { value: 100, label: statusText(job.status), indeterminate: false };
}
