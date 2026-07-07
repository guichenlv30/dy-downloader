"""抖音直播录制。

技术路径：
- 通过 `/webcast/room/web/enter/` 获取 stream_url，常见字段：
    * flv_pull_url: {SD, HD, FULL_HD, ORIGIN}
    * hls_pull_url_map: {HD1, HD2, HD3}
- 选择最高清可用的流，优先 FLV（单文件落盘简单）
- 使用 aiohttp 分块写入到 `.flv` 临时文件，完成后原子重命名
- 时长限制：read_timeout 自然结束或 max_duration_seconds 触发
- 不依赖 ffmpeg；若用户需要转码可后处理

限制：
- 不处理多人房间 / 连麦切换
- 不采集弹幕（后续可扩展）
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import aiofiles
import aiohttp

from core.downloader_base import BaseDownloader, DownloadResult
from utils.logger import setup_logger
from utils.naming import (
    DEFAULT_FILE_TEMPLATE,
    DEFAULT_FOLDER_TEMPLATE,
    build_live_context,
    render_template,
)

logger = setup_logger("LiveDownloader")


# 质量优先级：数字越大越高清
_FLV_QUALITY_ORDER = {
    "ORIGIN": 100,
    "FULL_HD1": 90,
    "FULL_HD": 90,
    "HD1": 70,
    "HD": 70,
    "SD1": 50,
    "SD2": 50,
    "SD": 50,
    "LD": 30,
}


class LiveDownloader(BaseDownloader):
    async def download(self, parsed_url: Dict[str, Any]) -> DownloadResult:
        result = DownloadResult()

        room_id = parsed_url.get("room_id")
        if not room_id:
            logger.error("No room_id found in parsed URL")
            return result

        result.total = 1
        self._progress_set_item_total(1, "直播录制")
        self._progress_update_step("获取直播间信息", f"room_id={room_id}")

        info = await self.api_client.get_live_room_info(
            str(room_id),
            sec_user_id=str(parsed_url.get("sec_user_id") or ""),
        )
        room = (info or {}).get("room") if isinstance(info, dict) else None
        if not info or not isinstance(room, dict) or not room:
            reason = ""
            if isinstance(info, dict):
                reason = str(info.get("unavailable_reason") or "")
            detail = reason or str(room_id)
            logger.error("Live room not available or fetch failed: %s (%s)", room_id, detail)
            self._progress_update_step("直播间不可用", detail)
            result.failed += 1
            self._progress_advance_item("failed", detail)
            return result

        user = info.get("user") or {}

        status = room.get("status")
        if status is not None and int(status or 0) != 2:
            # 2 = 正在直播；其他状态不录
            logger.warning("Room %s not live (status=%s); skipping", room_id, status)
            result.skipped += 1
            self._progress_advance_item("skipped", str(room_id))
            return result

        stream_url, quality = self._select_best_stream_url(room)
        if not stream_url:
            logger.error("No playable live stream URL for room %s", room_id)
            result.failed += 1
            self._progress_advance_item("failed", str(room_id))
            return result

        author_name = (user.get("nickname") or "unknown").strip() or "unknown"
        title = (room.get("title") or "直播").strip() or "直播"
        save_dir, file_stem = self._plan_output_paths(author_name, title, str(room_id))

        # 保存元数据
        meta_path = save_dir / f"{file_stem}_room.json"
        try:
            async with aiofiles.open(meta_path, "w", encoding="utf-8") as f:
                await f.write(json.dumps(info, ensure_ascii=False, indent=2))
        except Exception as exc:
            logger.debug("Save room meta failed: %s", exc)

        is_hls = ".m3u8" in stream_url.split("?")[0]
        suffix = ".flv" if not is_hls else ".m3u8"
        target_path = save_dir / f"{file_stem}{suffix}"
        if is_hls:
            # HLS 源只会下载 playlist（m3u8 文本），不是可直接播放的视频文件。
            # 告知用户正确的后处理方式。
            logger.warning(
                "选中的直播源为 HLS（m3u8 playlist），保存的将是播放列表文本而非视频。"
                "如需可播放文件，请用 ffmpeg 基于该 URL 抓流：ffmpeg -i '%s' -c copy out.ts",
                stream_url,
            )

        live_cfg = self._live_config()
        max_duration = float(live_cfg.get("max_duration_seconds") or 0)
        chunk_size = int(live_cfg.get("chunk_size") or 65536)
        idle_timeout = float(live_cfg.get("idle_timeout_seconds") or 30.0)

        self._progress_update_step(
            "录制直播流",
            f"quality={quality} | -> {target_path.name}",
        )

        try:
            ok = await self._record_stream(
                stream_url,
                target_path,
                max_duration=max_duration,
                chunk_size=chunk_size,
                idle_timeout=idle_timeout,
            )
        except asyncio.CancelledError:
            if target_path.exists():
                await self._finalize_live_artifact(
                    room_id=str(room_id),
                    title=title,
                    author_name=author_name,
                    user=user,
                    room=room,
                    info=info,
                    target_path=target_path,
                    meta_path=meta_path,
                    quality=quality,
                )
                self._progress_update_step("直播录制已停止", str(target_path))
            raise

        if ok:
            final_path = await self._finalize_live_artifact(
                room_id=str(room_id),
                title=title,
                author_name=author_name,
                user=user,
                room=room,
                info=info,
                target_path=target_path,
                meta_path=meta_path,
                quality=quality,
            )
            result.success += 1
            self._progress_advance_item("success", str(final_path))
            logger.info("Live recording finished: %s", final_path)
        else:
            result.failed += 1
            self._progress_advance_item("failed", str(room_id))

        return result

    # --- helpers ---

    def _live_config(self) -> Dict[str, Any]:
        cfg = self.config.get("live") or {}
        return cfg if isinstance(cfg, dict) else {}

    def _live_bool(self, key: str, default: bool) -> bool:
        value = self._live_config().get(key)
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(value)

    def _plan_output_paths(self, author_name: str, title: str, room_id: str) -> Tuple[Path, str]:
        started_at = datetime.now()
        date = started_at.strftime("%Y-%m-%d_%H%M")
        template_context = build_live_context(
            room_id=str(room_id),
            title=title,
            author_name=author_name,
            started_at=started_at,
        )
        filename_template = self.config.get("filename_template") or DEFAULT_FILE_TEMPLATE
        folder_template = self.config.get("folder_template") or DEFAULT_FOLDER_TEMPLATE
        file_stem = render_template(
            filename_template,
            template_context,
            fallback=f"{date}_{room_id}",
        )
        folder_name = render_template(
            folder_template,
            template_context,
            fallback=f"{date}_{room_id}",
        )
        save_dir = self.file_manager.get_save_path(
            author_name=author_name,
            mode="live",
            aweme_title=title,
            aweme_id=room_id,
            folderstyle=self.config.get("folderstyle", True),
            download_date=date,
            folder_name=folder_name,
            author_sec_uid=None,
            author_dir_style=self.config.get("author_dir") or "nickname",
            group_by_mode=self.config.get("group_by_mode", True),
        )
        return save_dir, file_stem

    async def _finalize_live_artifact(
        self,
        *,
        room_id: str,
        title: str,
        author_name: str,
        user: Dict[str, Any],
        room: Dict[str, Any],
        info: Dict[str, Any],
        target_path: Path,
        meta_path: Path,
        quality: str,
    ) -> Path:
        final_path = target_path
        source_path: Optional[Path] = None

        if target_path.suffix.lower() == ".flv" and self._live_bool("convert_to_mp4", True):
            mp4_path = target_path.with_suffix(".mp4")
            converted = await self._convert_flv_to_mp4(target_path, mp4_path)
            if converted:
                final_path = mp4_path
                if self._live_bool("keep_source_flv", True):
                    source_path = target_path
                else:
                    try:
                        target_path.unlink(missing_ok=True)
                    except Exception as exc:
                        source_path = target_path
                        logger.warning("Remove source FLV failed: %s", exc)
                self._progress_update_step("转换 MP4 完成", str(final_path))
            else:
                self._progress_update_step("转换 MP4 失败", "已保留 FLV 源文件")

        await self._record_live_artifact(
            room_id=room_id,
            title=title,
            author_name=author_name,
            user=user,
            room=room,
            info=info,
            target_path=final_path,
            meta_path=meta_path,
            quality=quality,
            source_path=source_path,
        )
        return final_path

    async def _convert_flv_to_mp4(self, source_path: Path, mp4_path: Path) -> bool:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            logger.warning("ffmpeg not found; skip live FLV to MP4 conversion")
            return False

        self._progress_update_step("转换 MP4", mp4_path.name)
        mp4_path.parent.mkdir(parents=True, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            ffmpeg,
            "-y",
            "-i",
            str(source_path),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(mp4_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _stdout, stderr = await proc.communicate()
        if proc.returncode != 0 or not mp4_path.exists() or mp4_path.stat().st_size <= 0:
            try:
                mp4_path.unlink(missing_ok=True)
            except Exception:
                pass
            detail = stderr.decode("utf-8", errors="ignore")[-1000:]
            logger.warning("Live FLV to MP4 conversion failed: %s", detail)
            return False
        return True

    async def _record_live_artifact(
        self,
        *,
        room_id: str,
        title: str,
        author_name: str,
        user: Dict[str, Any],
        room: Dict[str, Any],
        info: Dict[str, Any],
        target_path: Path,
        meta_path: Path,
        quality: str,
        source_path: Optional[Path] = None,
    ) -> None:
        if not self.database:
            return

        now_ts = int(datetime.now().timestamp())
        live_record_id = f"live_{room_id}_{int(time.time() * 1000)}"
        metadata = {
            "room_id": room_id,
            "title": title,
            "quality": quality,
            "media_path": str(target_path),
            "meta_path": str(meta_path),
            "source_flv_path": str(source_path) if source_path else "",
            "room": room,
            "user": user,
            "raw": info,
        }
        avatar_urls = self._user_avatar_urls(user)
        record = {
            "aweme_id": live_record_id,
            "aweme_type": "live",
            "title": title,
            "author_id": user.get("uid") or user.get("id") or "",
            "author_name": author_name,
            "author_sec_uid": user.get("sec_uid") or user.get("sec_user_id") or "",
            "create_time": now_ts,
            "file_path": str(target_path),
            "metadata": json.dumps(metadata, ensure_ascii=False),
            "cover_urls": json.dumps(avatar_urls, ensure_ascii=False),
            "job_id": self.job_id or "",
        }
        await self.database.add_aweme(record)
        artifact_paths = [target_path]
        if source_path and source_path != target_path and source_path.exists():
            artifact_paths.append(source_path)
        artifact_paths.append(meta_path)
        await self.metadata_handler.append_download_manifest(
            self.file_manager.base_path,
            {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "aweme_id": live_record_id,
                "author_name": author_name,
                "desc": title,
                "media_type": "live",
                "file_names": [path.name for path in artifact_paths],
                "file_paths": [self._to_manifest_path(path) for path in artifact_paths],
            },
        )

    @staticmethod
    def _user_avatar_urls(user: Dict[str, Any]) -> list[str]:
        for key in ("avatar_thumb", "avatar_medium", "avatar_larger"):
            avatar = user.get(key)
            if not isinstance(avatar, dict):
                continue
            urls = avatar.get("url_list")
            if isinstance(urls, list):
                return [url for url in urls if isinstance(url, str) and url]
        return []

    @staticmethod
    def _select_best_stream_url(room: Dict[str, Any]) -> Tuple[Optional[str], str]:
        """从 room.stream_url 中挑一条最佳地址。优先 FLV 高清。"""
        stream = room.get("stream_url") if isinstance(room, dict) else None
        if not isinstance(stream, dict):
            return None, ""

        # FLV 优先
        flv_map = stream.get("flv_pull_url")
        if isinstance(flv_map, dict) and flv_map:
            best_key = max(
                flv_map.keys(),
                key=lambda k: _FLV_QUALITY_ORDER.get(k.upper(), 0),
            )
            url = flv_map.get(best_key)
            if isinstance(url, str) and url:
                return url, best_key

        # 其次 HLS
        hls_map = stream.get("hls_pull_url_map")
        if isinstance(hls_map, dict) and hls_map:
            best_key = max(
                hls_map.keys(),
                key=lambda k: _FLV_QUALITY_ORDER.get(k.upper(), 0),
            )
            url = hls_map.get(best_key)
            if isinstance(url, str) and url:
                return url, best_key

        # 兜底：直接取根字段
        for key in ("flv_pull_url", "hls_pull_url", "rtmp_pull_url"):
            url = stream.get(key)
            if isinstance(url, str) and url:
                return url, key

        return None, ""

    async def _record_stream(
        self,
        url: str,
        target_path: Path,
        *,
        max_duration: float,
        chunk_size: int,
        idle_timeout: float,
    ) -> bool:
        """从 url 拉取字节流写入 target_path，直到流结束 / 超时 / 达到 max_duration。

        **数据保留策略**：主播下播、网络空闲、payload 截断等场景下，只要已经写入
        > 0 字节，就把 .tmp 提升为正式文件（录到一半的直播也比零字节有用）。
        仅 HTTP 4xx / 从未开始写入的情况下才会丢弃。
        """
        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = target_path.with_suffix(target_path.suffix + ".tmp")
        start = time.monotonic()
        bytes_written = 0
        last_chunk_ts = start
        last_progress_ts = start
        last_progress_bytes = 0

        # 直播 CDN 常同时校验 Referer 与 Origin 为 live.douyin.com（不是 www.douyin.com）。
        headers = self._download_headers()
        headers["Referer"] = "https://live.douyin.com/"
        headers["Origin"] = "https://live.douyin.com"

        def _promote_if_nonempty(reason: str) -> bool:
            if bytes_written <= 0:
                # 零字节也尝试清理 .tmp
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass
                return False
            try:
                os.replace(str(tmp_path), str(target_path))
            except Exception as exc:
                # 捕获所有异常：理论上只会是 OSError，但 rename 失败时宁可多兜底也别泄漏。
                logger.error("Live tmp → final rename failed: %s", exc)
                return False
            logger.info(
                "Live stream recorded (%s): %s (%.1fs, %.1f MiB)",
                reason,
                target_path.name,
                last_chunk_ts - start,
                bytes_written / (1024 * 1024),
            )
            return True

        session = await self.api_client.get_session()
        try:
            async with session.get(
                url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=None, sock_read=idle_timeout),
            ) as resp:
                if resp.status != 200:
                    logger.error("Live stream HTTP %s for %s", resp.status, target_path.name)
                    return False
                async with aiofiles.open(tmp_path, "wb") as f:
                    async for chunk in resp.content.iter_chunked(chunk_size):
                        if not chunk:
                            continue
                        await f.write(chunk)
                        bytes_written += len(chunk)
                        now = time.monotonic()
                        last_chunk_ts = now
                        if (
                            now - last_progress_ts >= 1.0
                            or bytes_written - last_progress_bytes >= 2 * 1024 * 1024
                        ):
                            elapsed = max(0.0, now - start)
                            self._progress_update_step(
                                "录制直播流",
                                f"已录制 {bytes_written / (1024 * 1024):.1f} MiB · {elapsed:.0f}s",
                            )
                            last_progress_ts = now
                            last_progress_bytes = bytes_written
                        if max_duration and (now - start) >= max_duration:
                            logger.info(
                                "Live max_duration reached (%.1fs), stopping.",
                                max_duration,
                            )
                            break
            return _promote_if_nonempty("stream ended")
        except asyncio.CancelledError:
            # 外部取消（Ctrl+C 等）：保留已录制内容
            _promote_if_nonempty("cancelled")
            raise
        except aiohttp.ClientPayloadError as exc:
            # 直播中断（主播下播）常见表现，视为正常结束
            logger.info("Live payload ended: %s", exc)
            return _promote_if_nonempty("payload ended")
        except (asyncio.TimeoutError, aiohttp.ServerTimeoutError) as exc:
            # sock_read 空闲超时——多数情况是主播停止推流，保留已录数据
            logger.info("Live stream idle timeout after %ss: %s", idle_timeout, exc)
            return _promote_if_nonempty("idle timeout")
        except Exception as exc:
            logger.error("Live stream recording failed: %s", exc)
            # 其它未知异常也尽量保留已写入的数据
            return _promote_if_nonempty("unexpected error")
