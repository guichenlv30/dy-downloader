"""LiveDownloader 测试。

用 asyncio 伪造一个 aiohttp-like session，校验流选择、跳过非直播状态、成功路径。
"""

import asyncio
from pathlib import Path

import pytest

from auth import CookieManager
from config import ConfigLoader
from control import QueueManager, RateLimiter, RetryHandler
from core.api_client import DouyinAPIClient
from core.live_downloader import LiveDownloader
from storage import Database, FileManager


class _FakeStreamResponse:
    """模拟 aiohttp 流式响应。"""

    def __init__(self, chunks, status: int = 200):
        self._chunks = list(chunks)
        self.status = status
        self.content = self
        self._consumed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def iter_chunked(self, size):
        async def gen():
            for c in self._chunks:
                yield c

        return gen()


class _FakeSession:
    def __init__(self, chunks, status: int = 200):
        self._chunks = chunks
        self._status = status

    def get(self, url, headers=None, timeout=None):
        return _FakeStreamResponse(self._chunks, self._status)


def _build_downloader(tmp_path):
    config = ConfigLoader()
    config.update(path=str(tmp_path), live={"convert_to_mp4": False, "keep_source_flv": True})

    file_manager = FileManager(str(tmp_path))
    cookie_manager = CookieManager(str(tmp_path / ".cookies.json"))
    api_client = DouyinAPIClient({})

    return LiveDownloader(
        config,
        api_client,
        file_manager,
        cookie_manager,
        database=None,
        rate_limiter=RateLimiter(max_per_second=5),
        retry_handler=RetryHandler(max_retries=1),
        queue_manager=QueueManager(max_workers=1),
    ), api_client


def _build_downloader_with_database(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)
    downloader.database = Database(str(tmp_path / "dy_downloader.db"))
    return downloader, api_client


class _ProgressProbe:
    def __init__(self):
        self.steps = []
        self.advanced = []

    def set_item_total(self, total, detail=""):
        self.total = total
        self.total_detail = detail

    def update_step(self, step, detail=""):
        self.steps.append((step, detail))

    def advance_item(self, status, detail=""):
        self.advanced.append((status, detail))


def test_select_best_stream_url_prefers_flv_origin():
    room = {
        "stream_url": {
            "flv_pull_url": {
                "SD": "https://cdn/sd.flv",
                "FULL_HD1": "https://cdn/fhd.flv",
                "HD1": "https://cdn/hd.flv",
            },
            "hls_pull_url_map": {
                "HD1": "https://cdn/hd.m3u8",
            },
        }
    }
    url, quality = LiveDownloader._select_best_stream_url(room)
    assert url == "https://cdn/fhd.flv"
    assert quality == "FULL_HD1"


def test_select_best_falls_back_to_hls():
    room = {
        "stream_url": {
            "hls_pull_url_map": {"HD1": "https://cdn/hd.m3u8", "SD": "https://cdn/sd.m3u8"},
        }
    }
    url, quality = LiveDownloader._select_best_stream_url(room)
    assert url == "https://cdn/hd.m3u8"
    assert quality == "HD1"


def test_select_best_returns_none_if_no_stream():
    assert LiveDownloader._select_best_stream_url({}) == (None, "")
    assert LiveDownloader._select_best_stream_url({"stream_url": {}}) == (None, "")


@pytest.mark.asyncio
async def test_live_downloader_skips_when_not_live(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {"room": {"status": 4, "stream_url": {}}, "user": {}}

    api_client.get_live_room_info = fake_get_live_room_info

    result = await downloader.download({"room_id": "42"})
    assert result.total == 1
    assert result.skipped == 1
    assert result.success == 0
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_records_stream(tmp_path, monkeypatch):
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "测试标题",
                "stream_url": {
                    "flv_pull_url": {"ORIGIN": "https://cdn/live.flv"},
                },
            },
            "user": {"nickname": "主播甲"},
        }

    api_client.get_live_room_info = fake_get_live_room_info

    async def fake_get_session():
        return _FakeSession([b"abc", b"def", b"ghi"])

    api_client.get_session = fake_get_session

    result = await downloader.download({"room_id": "42"})
    assert result.success == 1
    # 找到已落盘的 flv 文件
    flvs = list(tmp_path.rglob("*.flv"))
    assert len(flvs) == 1
    assert flvs[0].read_bytes() == b"abcdefghi"

    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_reports_recording_bytes(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)
    reporter = _ProgressProbe()
    downloader.progress_reporter = reporter

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "测试标题",
                "stream_url": {
                    "flv_pull_url": {"ORIGIN": "https://cdn/live.flv"},
                },
            },
            "user": {"nickname": "主播甲"},
        }

    api_client.get_live_room_info = fake_get_live_room_info

    async def fake_get_session():
        return _FakeSession([b"a" * (2 * 1024 * 1024)])

    api_client.get_session = fake_get_session

    result = await downloader.download({"room_id": "42"})

    assert result.success == 1
    assert any(step == "录制直播流" and "已录制 2.0 MiB" in detail for step, detail in reporter.steps)
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_records_archive_entry(tmp_path):
    downloader, api_client = _build_downloader_with_database(tmp_path)
    await downloader.database.initialize()
    downloader.job_id = "job-live-1"

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "测试直播",
                "stream_url": {
                    "flv_pull_url": {"ORIGIN": "https://cdn/live.flv"},
                },
            },
            "user": {
                "uid": "anchor-1",
                "sec_uid": "sec-anchor-1",
                "nickname": "主播",
                "avatar_thumb": {"url_list": ["https://img.example/avatar.jpg"]},
            },
        }

    api_client.get_live_room_info = fake_get_live_room_info

    async def fake_get_session():
        return _FakeSession([b"abc", b"def"])

    api_client.get_session = fake_get_session

    result = await downloader.download({"room_id": "42"})

    assert result.success == 1
    history = await downloader.database.get_aweme_history(aweme_type="live")
    assert history["total"] == 1
    item = history["items"][0]
    assert item["aweme_type"] == "live"
    assert item["title"] == "测试直播"
    assert item["author_name"] == "主播"
    assert item["author_sec_uid"] == "sec-anchor-1"
    assert item["job_id"] == "job-live-1"
    assert item["file_path"].endswith(".flv")
    assert Path(item["file_path"]).exists()
    assert item["cover_urls"] == ["https://img.example/avatar.jpg"]

    await downloader.database.close()
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_converts_to_mp4_and_keeps_flv(tmp_path, monkeypatch):
    downloader, api_client = _build_downloader_with_database(tmp_path)
    await downloader.database.initialize()
    downloader.config.update(live={"convert_to_mp4": True, "keep_source_flv": True})

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "转换测试",
                "stream_url": {"flv_pull_url": {"ORIGIN": "https://cdn/live.flv"}},
            },
            "user": {"uid": "anchor-1", "sec_uid": "sec-anchor-1", "nickname": "主播"},
        }

    async def fake_get_session():
        return _FakeSession([b"abc", b"def"])

    async def fake_convert(source_path, mp4_path):
        mp4_path.write_bytes(source_path.read_bytes())
        return True

    api_client.get_live_room_info = fake_get_live_room_info
    api_client.get_session = fake_get_session
    monkeypatch.setattr(downloader, "_convert_flv_to_mp4", fake_convert)

    result = await downloader.download({"room_id": "42"})

    assert result.success == 1
    flvs = list(tmp_path.rglob("*.flv"))
    mp4s = list(tmp_path.rglob("*.mp4"))
    assert len(flvs) == 1
    assert len(mp4s) == 1
    history = await downloader.database.get_aweme_history(aweme_type="live")
    item = history["items"][0]
    assert item["file_path"].endswith(".mp4")
    assert Path(item["file_path"]).exists()

    await downloader.database.close()
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_converts_to_mp4_and_removes_flv(tmp_path, monkeypatch):
    downloader, api_client = _build_downloader_with_database(tmp_path)
    await downloader.database.initialize()
    downloader.config.update(live={"convert_to_mp4": True, "keep_source_flv": False})

    async def fake_get_live_room_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "删除源文件测试",
                "stream_url": {"flv_pull_url": {"ORIGIN": "https://cdn/live.flv"}},
            },
            "user": {"uid": "anchor-1", "sec_uid": "sec-anchor-1", "nickname": "主播"},
        }

    async def fake_get_session():
        return _FakeSession([b"abc", b"def"])

    async def fake_convert(source_path, mp4_path):
        mp4_path.write_bytes(source_path.read_bytes())
        return True

    api_client.get_live_room_info = fake_get_live_room_info
    api_client.get_session = fake_get_session
    monkeypatch.setattr(downloader, "_convert_flv_to_mp4", fake_convert)

    result = await downloader.download({"room_id": "42"})

    assert result.success == 1
    assert list(tmp_path.rglob("*.flv")) == []
    mp4s = list(tmp_path.rglob("*.mp4"))
    assert len(mp4s) == 1
    history = await downloader.database.get_aweme_history(aweme_type="live")
    assert history["items"][0]["file_path"].endswith(".mp4")

    await downloader.database.close()
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_reports_failure_on_missing_stream(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_info(room_id, *, sec_user_id=""):
        return {"room": {"status": 2, "stream_url": {}}, "user": {}}

    api_client.get_live_room_info = fake_info
    result = await downloader.download({"room_id": "42"})
    assert result.failed == 1
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_fails_when_room_missing(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_info(room_id, *, sec_user_id=""):
        return None

    api_client.get_live_room_info = fake_info
    result = await downloader.download({"room_id": "42"})
    assert result.failed == 1
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_passes_sec_user_id(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)
    captured = {}

    async def fake_info(room_id, *, sec_user_id=""):
        captured["room_id"] = room_id
        captured["sec_user_id"] = sec_user_id
        return {"room": {}, "user": {}, "unavailable_reason": "不可用"}

    api_client.get_live_room_info = fake_info
    result = await downloader.download({"room_id": "42", "sec_user_id": "sec-42"})

    assert captured == {"room_id": "42", "sec_user_id": "sec-42"}
    assert result.failed == 1
    await api_client.close()


@pytest.mark.asyncio
async def test_live_downloader_reports_unavailable_reason(tmp_path):
    downloader, api_client = _build_downloader(tmp_path)
    reporter = _ProgressProbe()
    downloader.progress_reporter = reporter

    async def fake_info(room_id, *, sec_user_id=""):
        return {"room": {}, "user": {}, "unavailable_reason": "该内容暂时无法查看"}

    api_client.get_live_room_info = fake_info
    result = await downloader.download({"room_id": "42"})

    assert result.failed == 1
    assert ("直播间不可用", "该内容暂时无法查看") in reporter.steps
    assert reporter.advanced[-1] == ("failed", "该内容暂时无法查看")
    await api_client.close()


class _IdleTimeoutSession:
    """模拟写入一些数据后抛 asyncio.TimeoutError 的流。"""

    def __init__(self, chunks_before_timeout):
        self._chunks = chunks_before_timeout

    def get(self, url, headers=None, timeout=None):
        chunks = self._chunks

        class _Resp:
            status = 200

            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, exc_type, exc, tb):
                return False

            @property
            def content(self_inner):
                return self_inner

            def iter_chunked(self_inner, size):
                async def gen():
                    for c in chunks:
                        yield c
                    raise asyncio.TimeoutError("sock_read idle")

                return gen()

        return _Resp()


@pytest.mark.asyncio
async def test_live_downloader_preserves_partial_on_idle_timeout(tmp_path):
    """idle_timeout（主播停止推流 / 网络卡住）不应丢弃已录制的字节。"""
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "测试",
                "stream_url": {"flv_pull_url": {"ORIGIN": "https://cdn/live.flv"}},
            },
            "user": {"nickname": "主播"},
        }

    api_client.get_live_room_info = fake_info

    async def fake_get_session():
        return _IdleTimeoutSession([b"partial1", b"partial2"])

    api_client.get_session = fake_get_session

    result = await downloader.download({"room_id": "42"})
    assert result.success == 1  # 保留部分数据视为成功
    flvs = list(tmp_path.rglob("*.flv"))
    assert len(flvs) == 1
    assert flvs[0].read_bytes() == b"partial1partial2"
    # 没有遗留 .tmp 文件
    tmps = list(tmp_path.rglob("*.tmp"))
    assert tmps == []

    await api_client.close()


def test_download_headers_referer_for_live(tmp_path):
    """_record_stream 内部应把 Referer 改为 live.douyin.com（通过构造样本流间接验证）。"""
    # 直接读源码断言是更轻量的方式——避免走完整集成路径。

    source = Path("core/live_downloader.py").read_text(encoding="utf-8")
    assert 'headers["Referer"] = "https://live.douyin.com/"' in source


def test_download_headers_origin_for_live(tmp_path):
    """_record_stream 应同时改写 Origin 头（CDN 可能同时校验 Referer 与 Origin）。"""

    source = Path("core/live_downloader.py").read_text(encoding="utf-8")
    assert 'headers["Origin"] = "https://live.douyin.com"' in source


class _HeaderCapturingSession:
    """捕获 get() 调用时传入的 headers，供断言。"""

    def __init__(self, chunks):
        self._chunks = chunks
        self.captured_headers = None

    def get(self, url, headers=None, timeout=None):
        self.captured_headers = dict(headers or {})
        chunks = self._chunks

        class _Resp:
            status = 200

            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *_args):
                return False

            @property
            def content(self_inner):
                return self_inner

            def iter_chunked(self_inner, size):
                async def gen():
                    for c in chunks:
                        yield c

                return gen()

        return _Resp()


@pytest.mark.asyncio
async def test_live_recording_sends_live_origin_and_referer(tmp_path):
    """端到端验证：_record_stream 实际发出的请求头含正确的 live.douyin.com。"""
    downloader, api_client = _build_downloader(tmp_path)

    async def fake_info(room_id, *, sec_user_id=""):
        return {
            "room": {
                "status": 2,
                "title": "t",
                "stream_url": {"flv_pull_url": {"ORIGIN": "https://cdn/live.flv"}},
            },
            "user": {"nickname": "主播"},
        }

    api_client.get_live_room_info = fake_info
    capturing = _HeaderCapturingSession([b"data"])

    async def fake_get_session():
        return capturing

    api_client.get_session = fake_get_session

    await downloader.download({"room_id": "42"})
    assert capturing.captured_headers is not None
    assert capturing.captured_headers.get("Referer") == "https://live.douyin.com/"
    assert capturing.captured_headers.get("Origin") == "https://live.douyin.com"

    await api_client.close()
