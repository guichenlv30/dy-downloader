"""FastAPI REST 服务入口。

HTTP 层薄封装：
- 接收 URL，创建 job，返回 job_id
- 实际下载委托给 cli.main.download_url 的简化复用

fastapi/uvicorn 是**可选**依赖。若未安装，导入本模块会 ImportError。
"""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime, time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from auth import CookieManager
from config import ConfigLoader
from control import QueueManager, RateLimiter, RetryHandler
from core import DouyinAPIClient, DownloaderFactory, LoginRequiredError, URLParser
from server.jobs import DownloadJob, JobManager, JobStatus
from server.login import BrowserLoginManager, cookie_state
from storage import Database, FileManager
from utils.logger import setup_logger
from utils.validators import is_short_url, normalize_short_url

logger = setup_logger("REST")


class DownloadRequest(BaseModel):
    url: str
    mode: Optional[List[str]] = None
    number: Optional[Dict[str, int]] = None
    increase: Optional[Dict[str, bool]] = None
    collects_id: Optional[str] = None
    live: Optional[Dict[str, Any]] = None


class JobResponse(BaseModel):
    job_id: str
    status: str
    url: str


class SettingsPatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    data_dir: Optional[str] = None
    path: Optional[str] = None
    thread: Optional[int] = None
    rate_limit: Optional[float] = None
    retry_times: Optional[int] = None
    proxy: Optional[str] = None
    music: Optional[bool] = None
    cover: Optional[bool] = None
    avatar: Optional[bool] = None
    json_: Optional[bool] = Field(default=None, alias="json")
    download_pinned: Optional[bool] = None
    folderstyle: Optional[bool] = None
    group_by_mode: Optional[bool] = None
    author_dir: Optional[str] = None
    filename_template: Optional[str] = None
    folder_template: Optional[str] = None
    mode: Optional[List[str]] = None
    number: Optional[Dict[str, int]] = None
    increase: Optional[Dict[str, bool]] = None
    comments: Optional[Dict[str, Any]] = None
    live: Optional[Dict[str, Any]] = None


class ArchiveDeleteRequest(BaseModel):
    aweme_ids: List[str]


class FollowingSyncRequest(BaseModel):
    limit: int = 60


class CollectionsSyncRequest(BaseModel):
    limit: int = 80


class LoginStartRequest(BaseModel):
    login_url: Optional[str] = None
    timeout_seconds: Optional[int] = 300


class AuthorResolveRequest(BaseModel):
    url: str


ALLOWED_MODES = {"post", "like", "mix", "music", "collect", "collectmix"}
ALLOWED_AUTHOR_DIRS = {"nickname", "sec_uid", "nickname_uid", "user_sec_uid"}
URL_IN_TEXT_RE = re.compile(
    r"https?://(?:v\.douyin\.com|www\.douyin\.com|live\.douyin\.com|v\.iesdouyin\.com|webcast\.amemv\.com)/[^\s，。；;、]+",
    re.IGNORECASE,
)
GENERIC_URL_RE = re.compile(r"https?://[^\s，。；;、]+", re.IGNORECASE)
PRIMARY_MEDIA_SUFFIXES = {
    "video": {".mp4", ".m4v", ".mov"},
    "gallery": {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".m4v", ".mov"},
    "music": {".mp3", ".m4a", ".aac", ".wav", ".flac"},
}


class _ServerDeps:
    """跨请求复用的重量级依赖。

    REST 服务在进程生命周期内只需要一份 FileManager / RateLimiter / RetryHandler /
    QueueManager / CookieManager；每个请求重新构造既浪费又会触发文件系统 mkdir。
    DouyinAPIClient 由于持有 aiohttp.ClientSession，依旧按请求创建，避免跨请求泄漏
    连接状态或触发 "Session is closed" 错误。
    """

    def __init__(self, config: ConfigLoader):
        self.config = config
        # Resolve the cookie file path relative to the config file's directory
        # so the sidecar can find it regardless of its working directory (which
        # on macOS is often '/' when launched by Electron).
        cookie_file = str(_runtime_data_dir(config) / ".cookies.json")
        self.cookie_manager = CookieManager(cookie_file=cookie_file)
        # Load cookies from the config (env var / YAML cookie key) first, then
        # fall back to whatever is already on disk in the cookie file. This
        # ensures that cookies saved by a previous session are picked up on
        # restart even when the config doesn't embed them inline.
        initial_cookies = config.get_cookies()
        if initial_cookies:
            self.cookie_manager.set_cookies(initial_cookies)
        else:
            # Trigger a load from disk so get_cookies() returns the persisted
            # session without requiring a fresh login on every app restart.
            self.cookie_manager.get_cookies()
        self.file_manager = FileManager(config.get("path"))
        self.rate_limiter = RateLimiter(max_per_second=float(config.get("rate_limit", 2) or 2))
        self.retry_handler = RetryHandler(max_retries=int(config.get("retry_times", 3) or 3))
        self.queue_manager = QueueManager(max_workers=int(config.get("thread", 5) or 5))

    def refresh_runtime_config(self) -> None:
        cookie_file = _runtime_data_dir(self.config) / ".cookies.json"
        if self.cookie_manager.cookie_file.resolve() != cookie_file.resolve():
            self.cookie_manager = CookieManager(cookie_file=str(cookie_file))
            self.cookie_manager.get_cookies()
        self.file_manager = FileManager(self.config.get("path"))
        self.rate_limiter = RateLimiter(
            max_per_second=float(self.config.get("rate_limit", 2) or 2)
        )
        self.retry_handler = RetryHandler(max_retries=int(self.config.get("retry_times", 3) or 3))
        self.queue_manager = QueueManager(max_workers=int(self.config.get("thread", 5) or 5))


def _config_base_dir(config: ConfigLoader) -> Path:
    if config.config_path:
        return Path(config.config_path).resolve().parent
    return Path.cwd().resolve()


def _runtime_data_dir(config: ConfigLoader) -> Path:
    raw = str(config.get("data_dir") or "./data").strip() or "./data"
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (_config_base_dir(config) / path).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_path(path_value: Any, *, base_dir: Optional[Path] = None) -> str:
    raw = str(path_value or "")
    path = Path(raw or ".").expanduser()
    if not path.is_absolute():
        path = ((base_dir or Path.cwd().resolve()) / path).resolve()
    return str(path)


def _resolve_data_path(config: ConfigLoader, path_value: Any, default_name: str) -> str:
    raw = str(path_value or default_name).strip() or default_name
    path = Path(raw).expanduser()
    if path.is_absolute():
        return str(path)
    # Preserve explicit nested relative paths such as ./data/foo.db.
    if len(path.parts) > 1 and path.parts[0] in {".", "data", "./data"}:
        return str((_config_base_dir(config) / path).resolve())
    return str((_runtime_data_dir(config) / path).resolve())


def _archive_copy_path(config: ConfigLoader, file_path: Any, aweme_id: Any) -> str:
    raw = str(file_path or "").strip()
    if not raw:
        return ""
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (_config_base_dir(config) / path).resolve()
    leaf = path.name
    aweme = str(aweme_id or "").strip()
    if (aweme and aweme in leaf) or re.match(r"^\d{4}-\d{2}-\d{2}_", leaf):
        path = path.parent
    return str(path)


def _archive_author_path(config: ConfigLoader, file_path: Any) -> str:
    path_str = _archive_copy_path(config, file_path, "")
    if not path_str:
        return ""
    path = Path(path_str)
    if path.name in {"post", "like", "mix", "music", "collect", "collectmix", "live"}:
        path = path.parent
    return str(path)


def _stored_file_path(config: ConfigLoader, file_path: Any) -> Optional[Path]:
    raw = str(file_path or "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = (_config_base_dir(config) / path).resolve()
    return path


def _download_artifact_exists(path: Optional[Path], aweme_id: str, aweme_type: str) -> bool:
    if path is None or not path.exists():
        return False

    suffixes = PRIMARY_MEDIA_SUFFIXES.get(aweme_type) or set().union(
        *PRIMARY_MEDIA_SUFFIXES.values()
    )
    if path.is_file():
        if path.suffix.lower() not in suffixes:
            return False
        return not aweme_id or aweme_id in path.name

    try:
        files = [item for item in path.iterdir() if item.is_file()]
    except OSError:
        return False

    media_files = [item for item in files if item.suffix.lower() in suffixes]
    if not aweme_id:
        return False
    return any(aweme_id in item.name for item in media_files)


def _download_state(config: ConfigLoader, record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not record:
        return {"status": "none", "downloaded": False, "exists": False}
    path = _stored_file_path(config, record.get("file_path"))
    exists = _download_artifact_exists(
        path,
        str(record.get("aweme_id") or ""),
        str(record.get("aweme_type") or ""),
    )
    return {
        "status": "available" if exists else "missing",
        "downloaded": True,
        "exists": exists,
        "path": str(path) if path else "",
        "download_time": record.get("download_time"),
        "job_id": record.get("job_id") or "",
    }


async def _annotate_download_states(
    config: ConfigLoader,
    items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    aweme_ids = [
        str(item.get("aweme_id") or item.get("id") or "").strip()
        for item in items
        if item.get("type") in {"video", "gallery"}
    ]
    if not aweme_ids:
        return items

    db = await _query_database(config)
    try:
        records = await db.get_aweme_download_records(aweme_ids)
    finally:
        await db.close()

    for item in items:
        if item.get("type") in {"video", "gallery"}:
            aweme_id = str(item.get("aweme_id") or item.get("id") or "").strip()
            item["download_state"] = _download_state(config, records.get(aweme_id))
    return items


def _date_to_timestamp(value: Optional[str], *, end_of_day: bool = False) -> Optional[int]:
    if not value:
        return None
    try:
        parsed_date = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid date: {value}") from exc
    parsed_time = time.max if end_of_day else time.min
    return int(datetime.combine(parsed_date, parsed_time).timestamp())


def _extract_url_from_text(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    match = URL_IN_TEXT_RE.search(text) or GENERIC_URL_RE.search(text)
    if not match:
        return text
    return match.group(0).rstrip(".,!?，。！？)")


async def _query_database(config: ConfigLoader) -> Database:
    db_path = _resolve_data_path(config, config.get("database_path"), "dy_downloader.db")
    db = Database(db_path=db_path)
    await db.initialize()
    return db


def _config_summary(config: ConfigLoader, deps: _ServerDeps) -> Dict[str, Any]:
    cookies = deps.cookie_manager.get_cookies()
    state = cookie_state(cookies)
    server_cfg = config.get("server") or {}
    if not isinstance(server_cfg, dict):
        server_cfg = {}
    return {
        "data_dir": str(_runtime_data_dir(config)),
        "download_path": str(config.get("path") or "./Downloaded/"),
        "download_path_absolute": _resolve_path(
            config.get("path") or "./data/Downloaded/",
            base_dir=_config_base_dir(config),
        ),
        "thread": int(config.get("thread", 5) or 5),
        "rate_limit": float(config.get("rate_limit", 2) or 2),
        "retry_times": int(config.get("retry_times", 3) or 3),
        "proxy": str(config.get("proxy") or ""),
        "database": bool(config.get("database")),
        "database_path": _resolve_data_path(config, config.get("database_path"), "dy_downloader.db"),
        "media": {
            "music": bool(config.get("music")),
            "cover": bool(config.get("cover")),
            "avatar": bool(config.get("avatar")),
            "json": bool(config.get("json")),
            "download_pinned": bool(config.get("download_pinned")),
        },
        "naming": {
            "author_dir": str(config.get("author_dir") or "nickname"),
            "folderstyle": bool(config.get("folderstyle")),
            "group_by_mode": bool(config.get("group_by_mode", True)),
            "filename_template": str(config.get("filename_template") or "{date}_{title}_{id}"),
            "folder_template": str(config.get("folder_template") or "{date}_{title}_{id}"),
        },
        "mode": config.get("mode") or [],
        "number": config.get("number") or {},
        "increase": config.get("increase") or {},
        "comments": config.get("comments") or {},
        "live": config.get("live") or {},
        "cookies": {
            **state,
            "verified": False,
            "cookie_file": str(deps.cookie_manager.cookie_file),
        },
        "server": {
            "max_jobs": int(server_cfg.get("max_jobs") or JobManager.DEFAULT_MAX_JOBS),
            "job_ttl_seconds": float(
                server_cfg.get("job_ttl_seconds") or JobManager.DEFAULT_JOB_TTL_SECONDS
            ),
        },
    }


def _compact_user(user: Dict[str, Any]) -> Dict[str, Any]:
    avatar = user.get("avatar_thumb") or user.get("avatar_medium") or user.get("avatar_larger") or {}
    avatar_urls = avatar.get("url_list") if isinstance(avatar, dict) else []
    return {
        "uid": user.get("uid") or user.get("short_id") or "",
        "sec_uid": user.get("sec_uid") or user.get("sec_user_id") or "",
        "nickname": user.get("nickname") or "未命名账号",
        "signature": user.get("signature") or "",
        "avatar": avatar_urls[0] if isinstance(avatar_urls, list) and avatar_urls else "",
        "follower_count": int(user.get("follower_count") or 0),
        "following_count": int(user.get("following_count") or 0),
        "aweme_count": int(user.get("aweme_count") or 0),
        "favoriting_count": int(user.get("favoriting_count") or 0),
    }


def _first_url(source: Any) -> str:
    if isinstance(source, str):
        return source
    if not isinstance(source, dict):
        return ""
    url_list = source.get("url_list")
    if isinstance(url_list, list):
        return next((str(url) for url in url_list if url), "")
    for key in ("url", "uri"):
        if source.get(key):
            return str(source[key])
    return ""


def _first_positive_int(*values: Any) -> int:
    fallback = 0
    for value in values:
        if isinstance(value, (list, tuple, set)):
            candidate = len(value)
        else:
            try:
                candidate = int(value or 0)
            except (TypeError, ValueError):
                continue
        if candidate > 0:
            return candidate
        fallback = max(fallback, candidate)
    return fallback


def _cover_from_aweme(item: Dict[str, Any]) -> str:
    video = item.get("video") if isinstance(item.get("video"), dict) else {}
    cover = _first_url(video.get("cover") or video.get("origin_cover") or video.get("dynamic_cover"))
    if cover:
        return cover
    images = item.get("images")
    first_image = images[0] if isinstance(images, list) and images else None
    if isinstance(first_image, dict):
        return _first_url(first_image)
    return ""


def _aweme_media_type(item: Dict[str, Any]) -> str:
    images = item.get("images")
    if isinstance(images, list) and images:
        return "gallery"
    aweme_type = item.get("aweme_type")
    if isinstance(aweme_type, int) and aweme_type in {2, 68, 150}:
        video = item.get("video") if isinstance(item.get("video"), dict) else {}
        play_addr = video.get("play_addr") if isinstance(video, dict) else None
        return "video" if _first_url(play_addr) else "gallery"
    return "video"


def _compact_aweme(item: Dict[str, Any]) -> Dict[str, Any]:
    aweme_id = str(item.get("aweme_id") or item.get("group_id") or "").strip()
    media_type = _aweme_media_type(item)
    stats = item.get("statistics") if isinstance(item.get("statistics"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    url_kind = "note" if media_type == "gallery" else "video"
    return {
        "id": aweme_id,
        "aweme_id": aweme_id,
        "type": media_type,
        "title": item.get("desc") or item.get("caption") or aweme_id,
        "create_time": int(item.get("create_time") or 0),
        "cover": _cover_from_aweme(item),
        "author": _compact_user(author) if author else None,
        "stats": {
            "digg": int(stats.get("digg_count") or 0),
            "comment": int(stats.get("comment_count") or 0),
            "share": int(stats.get("share_count") or 0),
            "collect": int(stats.get("collect_count") or 0),
        },
        "url": f"https://www.douyin.com/{url_kind}/{aweme_id}" if aweme_id else "",
    }


def _extract_collects_id(item: Dict[str, Any]) -> str:
    collect_info = item.get("collects_info") if isinstance(item.get("collects_info"), dict) else {}
    return str(
        item.get("collects_id")
        or item.get("collects_id_str")
        or item.get("id")
        or collect_info.get("collects_id")
        or collect_info.get("collects_id_str")
        or ""
    ).strip()


def _compact_collect_folder(item: Dict[str, Any]) -> Dict[str, Any]:
    collect_info = item.get("collects_info") if isinstance(item.get("collects_info"), dict) else {}
    cover = item.get("cover") or item.get("cover_url") or collect_info.get("cover")
    collects_id = _extract_collects_id(item)
    count = _first_positive_int(
        item.get("aweme_count"),
        item.get("video_count"),
        item.get("item_count"),
        item.get("count"),
        item.get("total"),
        collect_info.get("aweme_count"),
        collect_info.get("video_count"),
        collect_info.get("item_count"),
        collect_info.get("count"),
        collect_info.get("total"),
    )
    return {
        "id": collects_id,
        "type": "folder",
        "title": (
            item.get("collects_name")
            or item.get("name")
            or collect_info.get("collects_name")
            or collect_info.get("name")
            or "未命名收藏夹"
        ),
        "count": count,
        "cover": _first_url(cover),
    }


def _extract_mix_id(item: Dict[str, Any]) -> str:
    mix_info = item.get("mix_info") if isinstance(item.get("mix_info"), dict) else {}
    return str(
        item.get("mix_id")
        or item.get("mixId")
        or item.get("id")
        or mix_info.get("mix_id")
        or mix_info.get("mixId")
        or mix_info.get("id")
        or ""
    ).strip()


def _compact_mix_item(item: Dict[str, Any]) -> Dict[str, Any]:
    mix_info = item.get("mix_info") if isinstance(item.get("mix_info"), dict) else item
    mix_id = _extract_mix_id(item)
    cover = mix_info.get("cover") or mix_info.get("mix_pic") or mix_info.get("cover_url")
    statis = mix_info.get("statis") if isinstance(mix_info.get("statis"), dict) else {}
    stats = mix_info.get("stats") if isinstance(mix_info.get("stats"), dict) else {}
    statistics = mix_info.get("statistics") if isinstance(mix_info.get("statistics"), dict) else {}
    series_info = (
        mix_info.get("series_new_mix_info")
        if isinstance(mix_info.get("series_new_mix_info"), dict)
        else {}
    )
    count = _first_positive_int(
        mix_info.get("aweme_count"),
        mix_info.get("video_count"),
        mix_info.get("item_count"),
        mix_info.get("mix_items_count"),
        mix_info.get("count"),
        mix_info.get("total"),
        statis.get("updated_to_episode"),
        statis.get("has_updated_episode"),
        statis.get("current_episode"),
        stats.get("updated_to_episode"),
        statistics.get("updated_to_episode"),
        series_info.get("updated_to_episode"),
        series_info.get("episode_count"),
        mix_info.get("ids"),
    )
    return {
        "id": mix_id,
        "type": "mix",
        "title": mix_info.get("mix_name") or mix_info.get("name") or "未命名合集",
        "desc": mix_info.get("desc") or mix_info.get("description") or "",
        "count": count,
        "cover": _first_url(cover),
        "url": f"https://www.douyin.com/collection/{mix_id}" if mix_id else "",
    }


def _extract_music_id(item: Dict[str, Any]) -> str:
    music_info = item.get("music_info") if isinstance(item.get("music_info"), dict) else item
    return str(music_info.get("music_id") or music_info.get("id") or item.get("music_id") or "").strip()


def _compact_music_item(item: Dict[str, Any]) -> Dict[str, Any]:
    music_info = item.get("music_info") if isinstance(item.get("music_info"), dict) else item
    music_id = _extract_music_id(item)
    cover = music_info.get("cover_large") or music_info.get("cover_medium") or music_info.get("cover_thumb")
    return {
        "id": music_id,
        "type": "music",
        "title": music_info.get("title") or music_info.get("music_name") or "未命名音乐",
        "desc": music_info.get("author") or "",
        "count": int(music_info.get("user_count") or music_info.get("aweme_count") or 0),
        "cover": _first_url(cover),
        "url": f"https://www.douyin.com/music/{music_id}" if music_id else "",
    }


def _download_overrides(req: DownloadRequest) -> Dict[str, Any]:
    overrides: Dict[str, Any] = {}
    if req.mode is not None:
        modes = [str(mode).strip() for mode in req.mode if str(mode).strip()]
        if not modes or any(mode not in ALLOWED_MODES for mode in modes):
            raise HTTPException(status_code=400, detail="invalid mode")
        if ("collect" in modes or "collectmix" in modes) and len(modes) > 1:
            raise HTTPException(status_code=400, detail="collect modes must be used alone")
        overrides["mode"] = modes
    if req.number is not None:
        overrides["number"] = {str(key): max(0, int(value)) for key, value in req.number.items()}
    if req.increase is not None:
        overrides["increase"] = {str(key): bool(value) for key, value in req.increase.items()}
    if req.collects_id is not None:
        overrides["collects_id"] = str(req.collects_id).strip()
    if req.live is not None:
        live = dict(req.live or {})
        current_live: Dict[str, Any] = {}
        if "max_duration_seconds" in live:
            current_live["max_duration_seconds"] = max(
                0,
                int(float(live.get("max_duration_seconds") or 0)),
            )
        if "idle_timeout_seconds" in live:
            idle_timeout = live.get("idle_timeout_seconds")
            current_live["idle_timeout_seconds"] = max(
                1,
                int(float(idle_timeout if idle_timeout is not None else 30)),
            )
        if current_live:
            overrides["live"] = current_live
    return overrides


def _search_verify_detail(page: Dict[str, Any]) -> str:
    raw = page.get("raw") if isinstance(page, dict) else {}
    if not isinstance(raw, dict):
        return ""
    nil_info = raw.get("search_nil_info")
    if not isinstance(nil_info, dict):
        return ""
    nil_type = str(nil_info.get("search_nil_type") or nil_info.get("search_nil_item") or "")
    if nil_type == "verify_check":
        return "抖音搜索接口要求验证。请在设置里重新登录抖音，或在登录浏览器中打开抖音搜索完成验证后再试。"
    if nil_type == "browser_verify_timeout":
        return "浏览器搜索验证超时。请在弹出的抖音浏览器里完成验证码后重新搜索。"
    return ""


def _config_for_job(config: ConfigLoader, overrides: Optional[Dict[str, Any]]) -> ConfigLoader:
    runtime_config = ConfigLoader(config.config_path)
    runtime_config.config = deepcopy(config.config)
    if overrides:
        runtime_config.update(**overrides)
    return runtime_config


def _require_login_cookies(deps: _ServerDeps) -> Dict[str, str]:
    cookies = deps.cookie_manager.get_cookies()
    if not cookies:
        raise HTTPException(status_code=401, detail="missing cookies")
    state = cookie_state(cookies)
    if not state["session_present"]:
        raise HTTPException(status_code=401, detail="missing login session cookie")
    return cookies


def _apply_settings_patch(config: ConfigLoader, deps: _ServerDeps, patch: SettingsPatch) -> None:
    updates = patch.model_dump(exclude_unset=True, by_alias=True)
    if not updates:
        return

    if "author_dir" in updates and updates["author_dir"] not in ALLOWED_AUTHOR_DIRS:
        raise HTTPException(status_code=400, detail="invalid author_dir")
    if "mode" in updates:
        modes = [str(mode).strip() for mode in updates["mode"] if str(mode).strip()]
        if not modes or any(mode not in ALLOWED_MODES for mode in modes):
            raise HTTPException(status_code=400, detail="invalid mode")
        if ("collect" in modes or "collectmix" in modes) and len(modes) > 1:
            raise HTTPException(status_code=400, detail="collect modes must be used alone")
        updates["mode"] = modes
    if "number" in updates:
        current_number = dict(config.get("number") or {})
        for key, value in updates["number"].items():
            if key in current_number:
                current_number[key] = max(0, int(value))
        updates["number"] = current_number
    if "increase" in updates:
        current_increase = dict(config.get("increase") or {})
        for key, value in updates["increase"].items():
            if key in current_increase:
                current_increase[key] = bool(value)
        updates["increase"] = current_increase
    if "comments" in updates:
        current_comments = dict(config.get("comments") or {})
        for key, value in updates["comments"].items():
            if key == "enabled":
                current_comments[key] = bool(value)
            elif key == "include_replies":
                current_comments[key] = bool(value)
            elif key in {"max_comments", "page_size"}:
                current_comments[key] = max(0, int(value or 0))
        updates["comments"] = current_comments
    if "live" in updates:
        current_live = dict(config.get("live") or {})
        for key, value in updates["live"].items():
            if key == "max_duration_seconds":
                current_live[key] = max(0, int(float(value or 0)))
            elif key == "idle_timeout_seconds":
                current_live[key] = max(1, int(float(value if value is not None else 30)))
            elif key == "chunk_size":
                current_live[key] = max(1024, int(value or 65536))
        updates["live"] = current_live

    config.update(**updates)
    deps.refresh_runtime_config()


async def _execute_download(
    url: str,
    deps: "_ServerDeps",
    overrides: Optional[Dict[str, Any]] = None,
    progress_reporter: Any = None,
    job_id: Optional[str] = None,
) -> Dict[str, int]:
    """简化版 download_url：只负责执行并返回成功/失败计数。

    有意不复用 cli.main.download_url —— 后者绑定了 progress_display 的 rich 状态。
    API client 仍按请求创建（aiohttp session 不跨请求复用）；其余重量级依赖从
    _ServerDeps 共享。
    """
    runtime_config = _config_for_job(deps.config, overrides)
    database = await _query_database(runtime_config) if runtime_config.get("database") else None
    try:
        # proxy 与 cli.main.download_url 对齐:API 请求、短链解析和 CDN 媒体
        # 下载(downloader_base 读 api_client.proxy)统一走配置代理。
        async with DouyinAPIClient(
            deps.cookie_manager.get_cookies(),
            proxy=runtime_config.get("proxy"),
        ) as api_client:
            if is_short_url(url):
                resolved = await api_client.resolve_short_url(normalize_short_url(url))
                if not resolved:
                    raise RuntimeError(f"Failed to resolve short URL: {url}")
                url = resolved

            parsed = URLParser.parse(url)
            if not parsed:
                raise RuntimeError(f"Unsupported URL: {url}")

            downloader = DownloaderFactory.create(
                parsed["type"],
                runtime_config,
                api_client,
                deps.file_manager,
                deps.cookie_manager,
                database,
                deps.rate_limiter,
                deps.retry_handler,
                deps.queue_manager,
                progress_reporter=progress_reporter,
                job_id=job_id,
            )
            if downloader is None:
                raise RuntimeError(f"No downloader for url_type={parsed['type']}")

            result = await downloader.download(parsed)
            return {
                "total": result.total,
                "success": result.success,
                "failed": result.failed,
                "skipped": result.skipped,
            }
    finally:
        if database:
            await database.close()


def build_app(config: ConfigLoader) -> FastAPI:
    deps = _ServerDeps(config)

    async def executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return await _execute_download(url, deps, overrides, progress_reporter, job_id)

    async def persist_job(job: DownloadJob) -> None:
        db = await _query_database(config)
        try:
            await db.upsert_job(job.to_dict())
        finally:
            await db.close()

    async def load_persisted_jobs(
        limit: Optional[int] = None,
        *,
        cancel_incomplete: bool = False,
    ) -> List[Dict[str, Any]]:
        db = await _query_database(config)
        try:
            return await db.load_jobs(limit=limit, cancel_incomplete=cancel_incomplete)
        finally:
            await db.close()

    async def delete_persisted_jobs(job_ids: List[str]) -> int:
        db = await _query_database(config)
        try:
            return await db.delete_jobs(job_ids)
        finally:
            await db.close()

    server_cfg = config.get("server") or {}
    if not isinstance(server_cfg, dict):
        server_cfg = {}
    manager = JobManager(
        executor=executor,
        max_concurrency=int(config.get("thread", 2) or 2),
        max_jobs=int(server_cfg.get("max_jobs") or JobManager.DEFAULT_MAX_JOBS),
        job_ttl_seconds=float(
            server_cfg.get("job_ttl_seconds") or JobManager.DEFAULT_JOB_TTL_SECONDS
        ),
        on_job_updated=persist_job,
    )
    login_manager = BrowserLoginManager(
        deps.cookie_manager,
        proxy=str(config.get("proxy") or ""),
        profile_dir=str(_runtime_data_dir(config) / "browser_profile"),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            await manager.restore(
                await load_persisted_jobs(
                    limit=manager.max_jobs,
                    cancel_incomplete=True,
                )
            )
        except Exception as exc:
            logger.warning("Failed to restore persisted jobs: %s", exc)
        yield
        await login_manager.shutdown()
        await manager.shutdown()

    app = FastAPI(
        title="Douyin Downloader API",
        version="1.0",
        description="REST API for dispatching Douyin download jobs.",
        lifespan=lifespan,
    )
    app.state.job_manager = manager
    app.state.login_manager = login_manager
    app.state.deps = deps
    app.state.config = config
    static_dir = Path(__file__).resolve().parent / "static"
    index_file = static_dir / "index.html"

    @app.get("/api/v1/health")
    async def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    async def frontend_index() -> FileResponse:
        if not index_file.exists():
            raise HTTPException(status_code=404, detail="frontend not found")
        return FileResponse(index_file)

    @app.get("/api/v1/config")
    async def config_info() -> Dict[str, Any]:
        return _config_summary(config, deps)

    @app.patch("/api/v1/config")
    async def update_config(req: SettingsPatch) -> Dict[str, Any]:
        _apply_settings_patch(config, deps, req)
        login_manager.proxy = str(config.get("proxy") or "")
        login_manager.cookie_manager = deps.cookie_manager
        saved = config.save()
        return {"saved": saved, "config": _config_summary(config, deps)}

    @app.post("/api/v1/cookies/clear")
    async def clear_cookies() -> Dict[str, Any]:
        deps.cookie_manager.clear_cookies()
        config.update(cookies={})
        return {"ok": True, "config": _config_summary(config, deps)}

    @app.post("/api/v1/login/start")
    async def start_login(req: LoginStartRequest) -> Dict[str, Any]:
        login_manager.proxy = str(config.get("proxy") or "")
        return await login_manager.start(
            login_url=req.login_url or "https://www.douyin.com/",
            timeout_seconds=int(req.timeout_seconds or 300),
        )

    @app.get("/api/v1/login/status")
    async def login_status() -> Dict[str, Any]:
        return await login_manager.status()

    @app.delete("/api/v1/login")
    async def cancel_login() -> Dict[str, Any]:
        return await login_manager.cancel()

    @app.get("/api/v1/account")
    async def account_info(fetch: bool = False) -> Dict[str, Any]:
        cookies = deps.cookie_manager.get_cookies()
        local_cookie_state = {
            **cookie_state(cookies),
            "verified": False,
            "cookie_file": str(deps.cookie_manager.cookie_file),
        }
        result: Dict[str, Any] = {
            "cookies": local_cookie_state,
            "profile": None,
            "verified": False,
        }
        if not fetch:
            return result

        if not cookies:
            raise HTTPException(status_code=401, detail="missing cookies")
        if not local_cookie_state["session_present"]:
            raise HTTPException(status_code=401, detail="missing login session cookie")
        try:
            async with DouyinAPIClient(
                cookies,
                proxy=deps.config.get("proxy"),
            ) as api_client:
                profile = await api_client.get_self_info()
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"account fetch failed: {exc}") from exc

        if not profile:
            raise HTTPException(status_code=502, detail="account profile unavailable")
        result["profile"] = _compact_user(profile)
        result["verified"] = True
        result["cookies"]["verified"] = True
        return result

    @app.post("/api/v1/following/sync")
    async def sync_following(req: FollowingSyncRequest) -> Dict[str, Any]:
        limit = max(1, min(int(req.limit or 60), 200))
        cookies = _require_login_cookies(deps)

        try:
            async with DouyinAPIClient(
                cookies,
                proxy=deps.config.get("proxy"),
            ) as api_client:
                profile = await api_client.get_self_info()
                sec_uid = str((profile or {}).get("sec_uid") or "")
                if not sec_uid:
                    raise HTTPException(status_code=401, detail="account profile unavailable")

                items: List[Dict[str, Any]] = []
                max_time = 0
                has_more = True
                pages = 0
                while has_more and len(items) < limit:
                    page = await api_client.get_following_page(
                        sec_uid,
                        max_time=max_time,
                        count=min(20, limit - len(items)),
                    )
                    pages += 1
                    raw_items = page.get("items") or []
                    items.extend(
                        _compact_user(item)
                        for item in raw_items
                        if isinstance(item, dict)
                    )
                    next_time = int(page.get("min_time") or 0)
                    has_more = bool(page.get("has_more")) and next_time > 0
                    if not has_more or next_time == max_time:
                        break
                    max_time = next_time
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"following sync failed: {exc}") from exc

        return {
            "account": _compact_user(profile or {}),
            "items": items[:limit],
            "has_more": has_more,
            "cursor": max_time,
            "pages": pages,
        }

    @app.post("/api/v1/collections/sync")
    async def sync_collections(req: CollectionsSyncRequest) -> Dict[str, Any]:
        limit = max(1, min(int(req.limit or 80), 200))
        cookies = _require_login_cookies(deps)

        try:
            async with DouyinAPIClient(cookies, proxy=deps.config.get("proxy")) as api_client:
                profile = await api_client.get_self_info()
                if not profile:
                    raise HTTPException(status_code=401, detail="account profile unavailable")

                folders: List[Dict[str, Any]] = []
                cursor = 0
                has_more = True
                while has_more and len(folders) < limit:
                    page = await api_client.get_user_collects(
                        "self",
                        max_cursor=cursor,
                        count=min(20, limit - len(folders)),
                    )
                    raw_items = page.get("items") or []
                    folders.extend(
                        _compact_collect_folder(item)
                        for item in raw_items
                        if isinstance(item, dict) and _extract_collects_id(item)
                    )
                    next_cursor = int(page.get("max_cursor") or 0)
                    has_more = bool(page.get("has_more")) and next_cursor != cursor
                    cursor = next_cursor

                mixes: List[Dict[str, Any]] = []
                cursor = 0
                has_more = True
                while has_more and len(mixes) < limit:
                    page = await api_client.get_user_collect_mix(
                        "self",
                        max_cursor=cursor,
                        count=min(20, limit - len(mixes)),
                    )
                    raw_items = page.get("items") or []
                    mixes.extend(
                        _compact_mix_item(item)
                        for item in raw_items
                        if isinstance(item, dict) and _extract_mix_id(item)
                    )
                    next_cursor = int(page.get("max_cursor") or 0)
                    has_more = bool(page.get("has_more")) and next_cursor != cursor
                    cursor = next_cursor
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"collections sync failed: {exc}") from exc

        return {
            "account": _compact_user(profile or {}),
            "folders": folders[:limit],
            "mixes": mixes[:limit],
        }

    @app.get("/api/v1/users/{sec_uid}/works")
    async def user_works(
        sec_uid: str,
        mode: str = Query("post", pattern="^(post|like|mix|music)$"),
        cursor: int = Query(0, ge=0),
        count: int = Query(24, ge=1, le=50),
    ) -> Dict[str, Any]:
        cookies = _require_login_cookies(deps)

        try:
            async with DouyinAPIClient(cookies, proxy=deps.config.get("proxy")) as api_client:
                profile = await api_client.get_user_info(sec_uid) if cursor == 0 else None
                if mode == "post":
                    page = await api_client.get_user_post(sec_uid, max_cursor=cursor, count=count)
                    items = [
                        _compact_aweme(item)
                        for item in page.get("items") or []
                        if isinstance(item, dict) and (item.get("aweme_id") or item.get("group_id"))
                    ]
                elif mode == "like":
                    page = await api_client.get_user_like(sec_uid, max_cursor=cursor, count=count)
                    items = [
                        _compact_aweme(item)
                        for item in page.get("items") or []
                        if isinstance(item, dict) and (item.get("aweme_id") or item.get("group_id"))
                    ]
                elif mode == "mix":
                    page = await api_client.get_user_mix(sec_uid, max_cursor=cursor, count=count)
                    items = [
                        _compact_mix_item(item)
                        for item in page.get("items") or []
                        if isinstance(item, dict) and _extract_mix_id(item)
                    ]
                else:
                    page = await api_client.get_user_music(sec_uid, max_cursor=cursor, count=count)
                    items = [
                        _compact_music_item(item)
                        for item in page.get("items") or []
                        if isinstance(item, dict) and _extract_music_id(item)
                    ]
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"user works fetch failed: {exc}") from exc

        items = await _annotate_download_states(config, items)
        return {
            "sec_uid": sec_uid,
            "mode": mode,
            "profile": _compact_user(profile or {}) if profile else None,
            "items": items,
            "has_more": bool(page.get("has_more")),
            "cursor": int(page.get("max_cursor") or 0),
        }

    @app.get("/api/v1/collections/{collection_type}/{collection_id}/works")
    async def collection_works(
        collection_type: str,
        collection_id: str,
        cursor: int = Query(0, ge=0),
        count: int = Query(24, ge=1, le=50),
    ) -> Dict[str, Any]:
        if collection_type not in {"folder", "mix"}:
            raise HTTPException(status_code=400, detail="invalid collection_type")
        cookies = _require_login_cookies(deps)

        try:
            async with DouyinAPIClient(cookies, proxy=deps.config.get("proxy")) as api_client:
                if collection_type == "folder":
                    page = await api_client.get_collect_aweme(
                        collection_id,
                        max_cursor=cursor,
                        count=count,
                    )
                else:
                    page = await api_client.get_mix_aweme(
                        collection_id,
                        cursor=cursor,
                        count=count,
                    )
                items = [
                    _compact_aweme(item)
                    for item in page.get("items") or []
                    if isinstance(item, dict) and (item.get("aweme_id") or item.get("group_id"))
                ]
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"collection works fetch failed: {exc}") from exc

        items = await _annotate_download_states(config, items)
        return {
            "collection_type": collection_type,
            "collection_id": collection_id,
            "items": items,
            "has_more": bool(page.get("has_more")),
            "cursor": int(page.get("max_cursor") or 0),
        }

    @app.get("/api/v1/search")
    async def keyword_search(
        keyword: str = Query(..., min_length=1),
        cursor: int = Query(0, ge=0),
        count: int = Query(24, ge=1, le=50),
        sort_type: int = Query(0, ge=0, le=2),
        publish_time: int = Query(0, ge=0),
    ) -> Dict[str, Any]:
        cookies = _require_login_cookies(deps)
        clean_keyword = keyword.strip()
        if not clean_keyword:
            raise HTTPException(status_code=400, detail="keyword is required")

        try:
            async with DouyinAPIClient(cookies, proxy=deps.config.get("proxy")) as api_client:
                page = await api_client.search_aweme(
                    clean_keyword,
                    offset=cursor,
                    count=count,
                    sort_type=sort_type,
                    publish_time=publish_time,
                )
                verify_detail = _search_verify_detail(page)
                if verify_detail and hasattr(api_client, "search_aweme_via_browser"):
                    page = await api_client.search_aweme_via_browser(
                        clean_keyword,
                        offset=cursor,
                        count=count,
                        sort_type=sort_type,
                        publish_time=publish_time,
                        user_data_dir=str(_runtime_data_dir(config) / "browser_profile"),
                    )
                items = [
                    _compact_aweme(item)
                    for item in page.get("items") or []
                    if isinstance(item, dict) and (item.get("aweme_id") or item.get("group_id"))
                ]
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"search failed: {exc}") from exc

        verify_detail = _search_verify_detail(page)
        if verify_detail:
            raise HTTPException(status_code=403, detail=verify_detail)

        items = await _annotate_download_states(config, items)
        return {
            "keyword": clean_keyword,
            "items": items,
            "has_more": bool(page.get("has_more")),
            "cursor": int(page.get("max_cursor") or 0),
        }

    @app.post("/api/v1/parse")
    async def parse_url(req: DownloadRequest) -> Dict[str, Any]:
        url = _extract_url_from_text(req.url)
        if not url:
            raise HTTPException(status_code=400, detail="url is required")
        parsed = URLParser.parse(url)
        return {
            "input": req.url,
            "url": url,
            "supported": parsed is not None,
            "parsed": parsed,
        }

    @app.post("/api/v1/author/resolve")
    async def resolve_author(req: AuthorResolveRequest) -> Dict[str, Any]:
        url = _extract_url_from_text(req.url)
        if not url:
            raise HTTPException(status_code=400, detail="url is required")

        resolved_url = url
        try:
            async with DouyinAPIClient(
                deps.cookie_manager.get_cookies(),
                proxy=deps.config.get("proxy"),
            ) as api_client:
                if is_short_url(resolved_url):
                    resolved = await api_client.resolve_short_url(normalize_short_url(resolved_url))
                    if not resolved:
                        raise HTTPException(status_code=400, detail="short url resolve failed")
                    resolved_url = resolved

                parsed = URLParser.parse(resolved_url)
                if not parsed or parsed.get("type") != "user" or not parsed.get("sec_uid"):
                    raise HTTPException(status_code=400, detail="not an author homepage link")

                sec_uid = str(parsed["sec_uid"])
                profile = await api_client.get_user_info(sec_uid)
        except HTTPException:
            raise
        except LoginRequiredError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"author resolve failed: {exc}") from exc

        return {
            "input": req.url,
            "url": resolved_url,
            "sec_uid": sec_uid,
            "profile": _compact_user(profile or {"sec_uid": sec_uid, "nickname": sec_uid}),
        }

    @app.post("/api/v1/download", response_model=JobResponse)
    async def create_job(req: DownloadRequest) -> JobResponse:
        url = _extract_url_from_text(req.url)
        if not url:
            raise HTTPException(status_code=400, detail="url is required")
        job = await manager.submit(url, overrides=_download_overrides(req))
        return JobResponse(job_id=job.job_id, status=job.status, url=job.url)

    @app.get("/api/v1/jobs/{job_id}")
    async def get_job(job_id: str) -> Dict[str, Any]:
        job = await manager.get(job_id)
        if job is None:
            persisted = [
                row for row in await load_persisted_jobs(limit=None)
                if row.get("job_id") == job_id
            ]
            if not persisted:
                raise HTTPException(status_code=404, detail="job not found")
            return DownloadJob.from_dict(persisted[0]).to_dict()
        return job.to_dict()

    @app.get("/api/v1/jobs")
    async def list_jobs() -> Dict[str, List[Dict[str, Any]]]:
        jobs_by_id = {job.job_id: job.to_dict() for job in await manager.list_jobs()}
        for row in await load_persisted_jobs(limit=manager.max_jobs):
            job_id = str(row.get("job_id") or "")
            if job_id and job_id not in jobs_by_id:
                jobs_by_id[job_id] = DownloadJob.from_dict(row).to_dict()
        jobs = sorted(
            jobs_by_id.values(),
            key=lambda item: str(item.get("created_at") or ""),
            reverse=True,
        )
        return {"jobs": jobs}

    @app.delete("/api/v1/jobs/{job_id}")
    async def delete_job(job_id: str) -> Dict[str, Any]:
        deleted = await manager.delete(job_id)
        deleted_persisted = await delete_persisted_jobs([job_id])
        if not deleted and not deleted_persisted:
            raise HTTPException(status_code=404, detail="job not found")
        return {"deleted": int(bool(deleted)) + int(deleted_persisted)}

    @app.delete("/api/v1/jobs")
    async def clear_jobs() -> Dict[str, Any]:
        jobs = await manager.list_jobs()
        terminal_ids = [job.job_id for job in jobs if job.status in JobStatus.TERMINAL]
        persisted_ids = [
            str(row.get("job_id") or "")
            for row in await load_persisted_jobs(limit=None)
            if row.get("job_id") and row.get("status") in JobStatus.TERMINAL
        ]
        ids_to_delete = list(dict.fromkeys(terminal_ids + persisted_ids))
        deleted = await manager.clear_terminal()
        deleted_persisted = await delete_persisted_jobs(ids_to_delete)
        return {"deleted": max(deleted, deleted_persisted)}

    @app.get("/api/v1/archive")
    async def archive(
        page: int = Query(1, ge=1),
        size: int = Query(20, ge=1, le=100),
        author: Optional[str] = None,
        title: Optional[str] = None,
        aweme_type: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        sort: str = "download_time",
    ) -> Dict[str, Any]:
        db = await _query_database(config)
        try:
            result = await db.get_aweme_history(
                page=page,
                size=size,
                author=author,
                title=title,
                aweme_type=aweme_type or None,
                date_from=_date_to_timestamp(date_from),
                date_to=_date_to_timestamp(date_to, end_of_day=True),
                sort=sort,
            )
            for item in result.get("items") or []:
                if isinstance(item, dict):
                    item["copy_path"] = _archive_copy_path(
                        config,
                        item.get("file_path"),
                        item.get("aweme_id"),
                    )
            return result
        finally:
            await db.close()

    @app.get("/api/v1/archive/authors")
    async def archive_authors(
        author: Optional[str] = None,
        title: Optional[str] = None,
        aweme_type: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Dict[str, Any]:
        db = await _query_database(config)
        try:
            items = await db.get_archive_authors(
                author=author,
                title=title,
                aweme_type=aweme_type or None,
                date_from=_date_to_timestamp(date_from),
                date_to=_date_to_timestamp(date_to, end_of_day=True),
            )
            for item in items:
                item["copy_path"] = _archive_author_path(config, item.get("file_path"))
            return {
                "total": sum(int(item.get("download_count") or 0) for item in items),
                "items": items,
            }
        finally:
            await db.close()

    @app.get("/api/v1/archive/top-authors")
    async def top_authors(
        days: int = Query(30, ge=1, le=365),
        limit: int = Query(8, ge=1, le=20),
    ) -> Dict[str, Any]:
        db = await _query_database(config)
        try:
            return {"items": await db.get_top_authors(days=days, limit=limit)}
        finally:
            await db.close()

    @app.delete("/api/v1/archive")
    async def delete_archive_items(req: ArchiveDeleteRequest) -> Dict[str, Any]:
        db = await _query_database(config)
        try:
            deleted = await db.delete_aweme_by_ids(req.aweme_ids)
            return {"deleted": deleted}
        finally:
            await db.close()

    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return app


async def run_server(config: ConfigLoader, *, host: str, port: int) -> None:
    import uvicorn

    app = build_app(config)
    uv_config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(uv_config)
    await server.serve()
