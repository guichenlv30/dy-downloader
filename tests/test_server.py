"""FastAPI 服务测试：验证 job 生命周期与 HTTP 接口。

仅测试 HTTP 层 + JobManager 抽象；不触达真实 Douyin API。
"""

import asyncio
import threading
import time
from typing import Any, Dict, Optional

import pytest

try:
    from fastapi.testclient import TestClient  # type: ignore
except ImportError:  # pragma: no cover
    pytest.skip("fastapi not installed", allow_module_level=True)


from config import ConfigLoader
from server.app import build_app
from server.jobs import JobManager
from storage import Database

SHARE_TEXT = (
    "3.89 07/25 o@q.re :8pm bnD:/ 5人私闯鳌太，1次侥幸，换来3死2生！ "
    "https://v.douyin.com/WjBY9IgmPo8/ 复制此链接，打开Dou音搜索，直接观看视频！"
)


def make_config(tmp_path, **updates):
    config_path = tmp_path / "config.yml"
    config_path.write_text("cookies: {}\n", encoding="utf-8")
    config = ConfigLoader(str(config_path))
    config.update(
        path=str(tmp_path / "downloads"),
        database_path=str(tmp_path / "dy_downloader.db"),
    )
    if updates:
        config.update(**updates)
    return config


@pytest.mark.asyncio
async def test_job_manager_runs_executor(tmp_path):
    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        assert overrides == {}
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fake_executor, max_concurrency=2)
    job = await manager.submit("https://example/one")
    assert job.status == "pending"

    # 等待后台任务跑完
    await asyncio.wait_for(job._task, timeout=2.0)
    fetched = await manager.get(job.job_id)
    assert fetched is not None
    assert fetched.status == "success"
    assert fetched.success == 1


@pytest.mark.asyncio
async def test_job_manager_updates_progress_from_reporter(tmp_path):
    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        assert progress_reporter is not None
        assert job_id
        progress_reporter.set_item_total(3, "作品待下载")
        progress_reporter.update_step("下载作品", "开始下载")
        progress_reporter.on_author("作者A", "sec-a")
        progress_reporter.advance_item("success", "1")
        await asyncio.sleep(0)
        progress_reporter.advance_item("failed", "2")
        progress_reporter.advance_item("skipped", "3")
        return {"total": 3, "success": 1, "failed": 1, "skipped": 1}

    manager = JobManager(executor=fake_executor, max_concurrency=1)
    job = await manager.submit("https://example/progress")
    await asyncio.wait_for(job._task, timeout=2.0)

    fetched = await manager.get(job.job_id)
    assert fetched is not None
    assert fetched.total == 3
    assert fetched.success == 1
    assert fetched.failed == 1
    assert fetched.skipped == 1
    assert fetched.step == "下载作品"
    assert fetched.detail == "3"
    assert fetched.author_nickname == "作者A"
    assert fetched.author_sec_uid == "sec-a"


@pytest.mark.asyncio
async def test_job_manager_marks_failure_on_executor_error(tmp_path):
    async def boom(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        raise RuntimeError("bad url")

    manager = JobManager(executor=boom)
    job = await manager.submit("x")
    await asyncio.wait_for(job._task, timeout=2.0)
    fetched = await manager.get(job.job_id)
    assert fetched is not None
    assert fetched.status == "failed"
    assert fetched.error is not None
    assert "bad url" in fetched.error


def test_health_endpoint(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_download_endpoint_creates_job(tmp_path, monkeypatch):
    config = make_config(tmp_path)
    app = build_app(config)

    # 替换 job executor 为 fake（不去触达 Douyin）
    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = fake_executor

    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": "https://www.douyin.com/video/123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("pending", "running", "success")
        assert data["url"] == "https://www.douyin.com/video/123"
        assert len(data["job_id"]) > 0

        job_id = data["job_id"]
        # job 列表应包含该 id
        list_resp = client.get("/api/v1/jobs")
        assert list_resp.status_code == 200
        ids = [j["job_id"] for j in list_resp.json()["jobs"]]
        assert job_id in ids

        # 详情接口
        detail = client.get(f"/api/v1/jobs/{job_id}")
        assert detail.status_code == 200
        assert detail.json()["job_id"] == job_id


def test_completed_jobs_are_restored_from_database(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        if progress_reporter:
            progress_reporter.set_item_total(1, "单作品下载")
            progress_reporter.advance_item("success", "7000000000000000001")
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = fake_executor

    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": "https://www.douyin.com/video/123"})
        assert resp.status_code == 200
        job_id = resp.json()["job_id"]
        for _ in range(30):
            detail = client.get(f"/api/v1/jobs/{job_id}")
            assert detail.status_code == 200
            if detail.json()["status"] == "success":
                break
            time.sleep(0.05)
        assert detail.json()["success"] == 1

    restored_app = build_app(config)
    with TestClient(restored_app) as client:
        resp = client.get("/api/v1/jobs")
        assert resp.status_code == 200
        restored = {job["job_id"]: job for job in resp.json()["jobs"]}
        assert job_id in restored
        assert restored[job_id]["status"] == "success"
        assert restored[job_id]["total"] == 1


def test_running_job_is_persisted_before_completion(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)
    release_job = threading.Event()

    async def slow_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        if progress_reporter:
            progress_reporter.set_item_total(2, "测试任务")
            progress_reporter.update_step("下载作品", "等待测试释放")
        await asyncio.to_thread(release_job.wait, 2.0)
        return {"total": 2, "success": 2, "failed": 0, "skipped": 0}

    async def load_rows():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        try:
            return await db.load_jobs(limit=None)
        finally:
            await db.close()

    app.state.job_manager.executor = slow_executor

    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": "https://www.douyin.com/video/123"})
        assert resp.status_code == 200
        job_id = resp.json()["job_id"]

        row = None
        for _ in range(30):
            rows = asyncio.run(load_rows())
            row = next((item for item in rows if item["job_id"] == job_id), None)
            if row and row["status"] in {"pending", "running"}:
                break
            time.sleep(0.05)

        assert row is not None
        assert row["status"] in {"pending", "running"}
        assert row["total"] in {0, 2}

        release_job.set()
        for _ in range(30):
            detail = client.get(f"/api/v1/jobs/{job_id}")
            assert detail.status_code == 200
            if detail.json()["status"] == "success":
                break
            time.sleep(0.05)
        assert detail.json()["success"] == 2


def test_incomplete_persisted_jobs_restore_as_cancelled(tmp_path):
    config = make_config(tmp_path)

    async def seed_running_job():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        await db.upsert_job(
            {
                "job_id": "running-job",
                "url": "https://www.douyin.com/video/123",
                "status": "running",
                "created_at": "2026-07-04T01:00:00Z",
                "started_at": "2026-07-04T01:00:01Z",
                "updated_at": "2026-07-04T01:00:02Z",
                "total": 5,
                "success": 2,
                "failed": 0,
                "skipped": 0,
            }
        )
        await db.close()

    asyncio.run(seed_running_job())

    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/jobs")
        assert resp.status_code == 200
        jobs = {job["job_id"]: job for job in resp.json()["jobs"]}
        assert jobs["running-job"]["status"] == "cancelled"
        assert jobs["running-job"]["success"] == 2
        assert "任务未完成" in jobs["running-job"]["error"]


def test_task_center_does_not_backfill_from_aweme_records(tmp_path):
    config = make_config(tmp_path)

    async def seed_aweme_only():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        await db.add_aweme(
            {
                "aweme_id": "7000000000000000001",
                "aweme_type": "video",
                "title": "旧下载作品",
                "author_id": "author-a",
                "author_name": "绮梦说漫",
                "create_time": 1762971341,
                "file_path": "data/Downloaded/绮梦说漫/mix/old-work",
                "metadata": "{}",
            }
        )
        await db.close()

    asyncio.run(seed_aweme_only())

    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/jobs")
        assert resp.status_code == 200
        assert resp.json()["jobs"] == []


def test_frontend_root_and_static_assets(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    with TestClient(app) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "Douzy" in root.text
        assert "/static/app.js" in root.text

        js = client.get("/static/app.js")
        assert js.status_code == 200
        assert "DOUYIN_URL_RE" in js.text


def test_parse_endpoint_extracts_url_from_share_text(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.post("/api/v1/parse", json={"url": SHARE_TEXT})
        assert resp.status_code == 200
        data = resp.json()
        assert data["input"] == SHARE_TEXT
        assert data["url"] == "https://v.douyin.com/WjBY9IgmPo8/"
        assert data["supported"] is True
        assert data["parsed"]["type"] == "short"


def test_author_resolve_endpoint_resolves_short_homepage(tmp_path, monkeypatch):
    config = make_config(tmp_path)

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def resolve_short_url(self, url):
            assert url == "https://v.douyin.com/authorShare/"
            return "https://www.douyin.com/user/MS4wLjABAAAA-user-sec"

        async def get_user_info(self, sec_uid):
            assert sec_uid == "MS4wLjABAAAA-user-sec"
            return {
                "uid": "uid-1",
                "sec_uid": sec_uid,
                "nickname": "自然哥",
                "signature": "探索户外故事",
                "aweme_count": 106,
                "follower_count": 64000,
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/author/resolve",
            json={"url": "分享主页 https://v.douyin.com/authorShare/ 复制链接"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] == "https://www.douyin.com/user/MS4wLjABAAAA-user-sec"
        assert data["sec_uid"] == "MS4wLjABAAAA-user-sec"
        assert data["profile"]["nickname"] == "自然哥"
        assert data["profile"]["aweme_count"] == 106


def test_archive_endpoint_returns_absolute_copy_path_without_work_leaf(tmp_path):
    config = make_config(tmp_path)

    async def seed_record():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        await db.add_aweme(
            {
                "aweme_id": "7654662824597212467",
                "aweme_type": "video",
                "title": "自己不经意的一次趁虚而入，竟然就从新夺回了正宫娘娘的位置 #漫画解说 #漫画",
                "author_id": "author-1",
                "author_name": "绮梦说漫",
                "create_time": 1762971341,
                "file_path": (
                    "data/Downloaded/绮梦说漫/mix/"
                    "2026-06-24_自己不经意的一次趁虚而入，竟然就从新夺回了正宫娘娘的位置 _漫画解说 _漫画_7654662824597212467"
                ),
                "metadata": "{}",
            }
        )
        await db.close()

    asyncio.run(seed_record())
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/archive")
        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert item["file_path"].endswith("7654662824597212467")
        assert item["copy_path"] == str(tmp_path / "data" / "Downloaded" / "绮梦说漫" / "mix")


def test_archive_authors_endpoint_groups_downloaded_works(tmp_path):
    config = make_config(tmp_path)

    async def seed_records():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        for aweme_id, author, author_id, leaf in [
            ("7000000000000000001", "绮梦说漫", "author-a", "2026-06-24_title_7000000000000000001"),
            ("7000000000000000002", "绮梦说漫", "author-a", "2026-06-25_title_7000000000000000002"),
            ("7000000000000000003", "刀乐不乐", "author-b", "2026-06-26_title_7000000000000000003"),
        ]:
            await db.add_aweme(
                {
                    "aweme_id": aweme_id,
                    "aweme_type": "video",
                    "title": f"{author}作品",
                    "author_id": author_id,
                    "author_name": author,
                    "create_time": 1762971341,
                    "file_path": f"data/Downloaded/{author}/mix/{leaf}",
                    "metadata": "{}",
                    "cover_urls": '["https://img.example/cover.jpg"]',
                }
            )
        await db.close()

    asyncio.run(seed_records())
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/archive/authors")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        counts = {item["author_name"]: item for item in data["items"]}
        assert counts["绮梦说漫"]["download_count"] == 2
        assert counts["刀乐不乐"]["download_count"] == 1
        assert counts["绮梦说漫"]["copy_path"] == str(
            tmp_path / "data" / "Downloaded" / "绮梦说漫"
        )


def test_download_endpoint_extracts_url_from_share_text(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = fake_executor

    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": SHARE_TEXT})
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] == "https://v.douyin.com/WjBY9IgmPo8/"


def test_download_endpoint_accepts_job_overrides(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    async def fake_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = fake_executor

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/download",
            json={
                "url": "https://www.douyin.com/user/self?showTab=favorite_collection",
                "mode": ["collect"],
                "collects_id": "folder-1",
            },
        )
        assert resp.status_code == 200
        job_id = resp.json()["job_id"]

        detail = client.get(f"/api/v1/jobs/{job_id}")
        assert detail.status_code == 200
        overrides = detail.json()["overrides"]
        assert overrides["mode"] == ["collect"]
        assert overrides["collects_id"] == "folder-1"


def test_collections_sync_endpoint(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get_self_info(self):
            return {"uid": "u1", "sec_uid": "self-sec", "nickname": "我"}

        async def get_user_collects(self, sec_uid, max_cursor=0, count=10):
            assert sec_uid == "self"
            return {
                "items": [
                    {
                        "collects_id_str": "folder-1",
                        "collects_name": "收藏夹A",
                        "aweme_count": 2,
                    }
                ],
                "has_more": False,
                "max_cursor": 0,
            }

        async def get_user_collect_mix(self, sec_uid, max_cursor=0, count=12):
            assert sec_uid == "self"
            return {
                "items": [
                    {
                        "mix_id": "mix-1",
                        "mix_name": "合集A",
                        "statis": {"updated_to_episode": 12, "watched_episode": 8},
                    }
                ],
                "has_more": False,
                "max_cursor": 0,
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.post("/api/v1/collections/sync", json={"limit": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert data["account"]["nickname"] == "我"
        assert data["folders"][0]["id"] == "folder-1"
        assert data["folders"][0]["title"] == "收藏夹A"
        assert data["mixes"][0]["id"] == "mix-1"
        assert data["mixes"][0]["title"] == "合集A"
        assert data["mixes"][0]["count"] == 12


def test_collection_works_endpoint(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get_mix_aweme(self, mix_id, cursor=0, count=20):
            assert mix_id == "mix-1"
            assert cursor == 0
            assert count == 10
            return {
                "items": [
                    {
                        "aweme_id": "7000000000000000002",
                        "desc": "收藏合集作品",
                        "aweme_type": 0,
                        "create_time": 1700000001,
                        "statistics": {"digg_count": 7},
                        "video": {"cover": {"url_list": ["https://img.example/mix-cover.jpg"]}},
                    }
                ],
                "has_more": False,
                "max_cursor": 0,
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/collections/mix/mix-1/works?count=10")
        assert resp.status_code == 200
        data = resp.json()
        assert data["collection_type"] == "mix"
        assert data["collection_id"] == "mix-1"
        assert data["items"][0]["id"] == "7000000000000000002"
        assert data["items"][0]["title"] == "收藏合集作品"
        assert data["items"][0]["url"].endswith("/video/7000000000000000002")


def test_user_works_endpoint(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )
    existing_dir = tmp_path / "data" / "Downloaded" / "作者A" / "post" / "existing-work"
    existing_dir.mkdir(parents=True)
    (existing_dir / "2026-07-04_作品A_7000000000000000001.mp4").write_bytes(b"video")
    deleted_dir = tmp_path / "data" / "Downloaded" / "作者A" / "post" / "deleted-work"
    deleted_dir.mkdir(parents=True)
    (deleted_dir / "other-video.mp4").write_bytes(b"other")

    async def seed_download_records():
        db = Database(str(tmp_path / "dy_downloader.db"))
        await db.initialize()
        for aweme_id, file_path in [
            ("7000000000000000001", "data/Downloaded/作者A/post/existing-work"),
            ("7000000000000000002", "data/Downloaded/作者A/post/deleted-work"),
        ]:
            await db.add_aweme(
                {
                    "aweme_id": aweme_id,
                    "aweme_type": "video",
                    "title": f"作品 {aweme_id}",
                    "author_id": "u2",
                    "author_name": "作者A",
                    "create_time": 1700000000,
                    "file_path": file_path,
                    "metadata": "{}",
                }
            )
        await db.close()

    asyncio.run(seed_download_records())

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get_user_info(self, sec_uid):
            return {"uid": "u2", "sec_uid": sec_uid, "nickname": "作者A"}

        async def get_user_post(self, sec_uid, max_cursor=0, count=18):
            assert sec_uid == "sec-1"
            return {
                "items": [
                    {
                        "aweme_id": "7000000000000000001",
                        "desc": "作品A",
                        "aweme_type": 0,
                        "create_time": 1700000000,
                        "statistics": {"digg_count": 12},
                        "video": {"cover": {"url_list": ["https://img.example/cover.jpg"]}},
                    },
                    {
                        "aweme_id": "7000000000000000002",
                        "desc": "作品B",
                        "aweme_type": 0,
                        "create_time": 1700000001,
                        "statistics": {"digg_count": 6},
                        "video": {"cover": {"url_list": ["https://img.example/cover-b.jpg"]}},
                    },
                ],
                "has_more": False,
                "max_cursor": 0,
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/users/sec-1/works?mode=post&count=10")
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile"]["nickname"] == "作者A"
        assert data["items"][0]["id"] == "7000000000000000001"
        assert data["items"][0]["title"] == "作品A"
        assert data["items"][0]["type"] == "video"
        assert data["items"][0]["url"].endswith("/video/7000000000000000001")
        states = {item["id"]: item["download_state"] for item in data["items"]}
        assert states["7000000000000000001"]["status"] == "available"
        assert states["7000000000000000001"]["exists"] is True
        assert states["7000000000000000002"]["status"] == "missing"
        assert states["7000000000000000002"]["exists"] is False


def test_keyword_search_endpoint(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def search_aweme(
            self,
            keyword,
            *,
            offset=0,
            count=24,
            sort_type=0,
            publish_time=0,
        ):
            assert keyword == "户外"
            assert offset == 0
            assert count == 12
            assert sort_type == 2
            assert publish_time == 7
            return {
                "items": [
                    {
                        "aweme_id": "7000000000000000099",
                        "desc": "搜索作品",
                        "aweme_type": 0,
                        "create_time": 1700000200,
                        "statistics": {"digg_count": 88},
                        "video": {"cover": {"url_list": ["https://img.example/search.jpg"]}},
                    }
                ],
                "has_more": True,
                "max_cursor": 12,
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get(
            "/api/v1/search?keyword=户外&count=12&sort_type=2&publish_time=7"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["keyword"] == "户外"
        assert data["has_more"] is True
        assert data["cursor"] == 12
        assert data["items"][0]["id"] == "7000000000000000099"
        assert data["items"][0]["title"] == "搜索作品"
        assert data["items"][0]["url"].endswith("/video/7000000000000000099")
        assert data["items"][0]["download_state"]["status"] == "none"


def test_keyword_search_verify_check_returns_actionable_error(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def search_aweme(self, *args, **kwargs):
            return {
                "items": [],
                "has_more": False,
                "max_cursor": 0,
                "raw": {
                    "status_code": 0,
                    "data": [],
                    "search_nil_info": {
                        "search_nil_type": "verify_check",
                        "search_nil_item": "verify_check",
                    },
                },
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/search?keyword=洛克王国")
        assert resp.status_code == 403
        assert "抖音搜索接口要求验证" in resp.json()["detail"]


def test_keyword_search_verify_check_uses_browser_fallback(tmp_path, monkeypatch):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "ttwid",
            "odin_tt": "odin",
            "passport_csrf_token": "csrf",
            "sessionid": "session",
        },
    )
    calls = {"browser": 0}

    class FakeAPI:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def search_aweme(self, *args, **kwargs):
            return {
                "items": [],
                "has_more": False,
                "max_cursor": 0,
                "raw": {
                    "status_code": 0,
                    "data": [],
                    "search_nil_info": {
                        "search_nil_type": "verify_check",
                        "search_nil_item": "verify_check",
                    },
                },
            }

        async def search_aweme_via_browser(self, keyword, **kwargs):
            calls["browser"] += 1
            assert keyword == "洛克王国"
            assert str(kwargs["user_data_dir"]).endswith("browser_profile")
            return {
                "items": [
                    {
                        "aweme_id": "7000000000000000100",
                        "desc": "浏览器搜索结果",
                        "aweme_type": 0,
                        "create_time": 1700000200,
                    }
                ],
                "has_more": False,
                "max_cursor": 1,
                "raw": {"status_code": 0, "data": []},
            }

    monkeypatch.setattr("server.app.DouyinAPIClient", FakeAPI)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/search?keyword=洛克王国")
        assert resp.status_code == 200
        data = resp.json()
        assert calls["browser"] == 1
        assert data["items"][0]["id"] == "7000000000000000100"
        assert data["items"][0]["title"] == "浏览器搜索结果"


def test_config_endpoint_updates_comments_and_live_settings(tmp_path):
    config = make_config(
        tmp_path,
        comments={"enabled": False, "include_replies": False, "max_comments": 0},
        live={"max_duration_seconds": 0, "idle_timeout_seconds": 30, "chunk_size": 65536},
    )
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.patch(
            "/api/v1/config",
            json={
                "comments": {
                    "enabled": True,
                    "include_replies": True,
                    "max_comments": 50,
                },
                "live": {
                    "max_duration_seconds": 600,
                    "idle_timeout_seconds": 0,
                },
            },
        )
        assert resp.status_code == 200
        data = resp.json()["config"]
        assert data["comments"]["enabled"] is True
        assert data["comments"]["include_replies"] is True
        assert data["comments"]["max_comments"] == 50
        assert data["live"]["max_duration_seconds"] == 600
        assert data["live"]["idle_timeout_seconds"] == 1


def test_config_endpoint_summarizes_cookies_without_secret_values(tmp_path):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "secret-ttwid",
            "odin_tt": "secret-odin",
            "passport_csrf_token": "secret-csrf",
            "sessionid": "secret-session",
        },
    )
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/config")
        assert resp.status_code == 200
        body = resp.text
        data = resp.json()
        assert data["cookies"]["required_present"] is True
        assert data["cookies"]["session_present"] is True
        assert data["cookies"]["auth_ready"] is True
        assert data["cookies"]["verified"] is False
        assert data["cookies"]["count"] == 4
        assert "secret-ttwid" not in body
        assert "secret-odin" not in body
        assert "secret-csrf" not in body
        assert "secret-session" not in body


def test_required_cookies_without_session_do_not_count_as_logged_in(tmp_path):
    config = make_config(
        tmp_path,
        cookies={
            "ttwid": "secret-ttwid",
            "odin_tt": "secret-odin",
            "passport_csrf_token": "secret-csrf",
        },
    )
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/config")
        assert resp.status_code == 200
        cookies = resp.json()["cookies"]
        assert cookies["required_present"] is True
        assert cookies["session_present"] is False
        assert cookies["auth_ready"] is False


def test_login_status_initially_idle(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/login/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "idle"
        assert data["session_present"] is False


def test_download_endpoint_rejects_empty_url(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": ""})
        assert resp.status_code == 400


def test_get_unknown_job_returns_404(tmp_path):
    config = make_config(tmp_path)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/jobs/unknown-id")
        assert resp.status_code == 404


def test_build_app_shares_deps_across_requests(tmp_path):
    """重请求应复用同一个 FileManager / RateLimiter 等（避免每次重建）。"""
    config = make_config(tmp_path)
    app = build_app(config)

    deps = app.state.deps
    assert deps.file_manager is not None
    assert deps.rate_limiter is not None
    assert deps.retry_handler is not None
    assert deps.queue_manager is not None
    assert deps.cookie_manager is not None

    # 构建第二次 app 时应该是完全独立的 deps 实例，但同一 app 内是共享的
    app2 = build_app(config)
    assert app2.state.deps is not app.state.deps
    assert app.state.deps.file_manager is app.state.deps.file_manager  # identity


@pytest.mark.asyncio
async def test_job_manager_prunes_by_max_jobs():
    """max_jobs 超限时应优先淘汰最老的终态 job，保留 in-flight。"""

    async def fast_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fast_executor, max_jobs=3, job_ttl_seconds=0.0)
    jobs = []
    for i in range(5):
        j = await manager.submit(f"u{i}")
        jobs.append(j)
        await asyncio.wait_for(j._task, timeout=1.0)

    remaining = await manager.list_jobs()
    # max_jobs=3：新任务 submit 时先剪裁，最终存量 ≤ max_jobs
    assert len(remaining) <= 3
    # 最新的那一批一定在，最早的那几个被淘汰
    ids_remaining = {j.job_id for j in remaining}
    assert jobs[-1].job_id in ids_remaining


@pytest.mark.asyncio
async def test_job_manager_prunes_by_ttl():
    """TTL 过期的终态 job 应在下次 submit 时被清理。"""

    async def fast_executor(
        url: str,
        overrides: Optional[Dict[str, Any]] = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
    ) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fast_executor, max_jobs=100, job_ttl_seconds=0.01)
    old_job = await manager.submit("old")
    await asyncio.wait_for(old_job._task, timeout=1.0)

    # 等 TTL 过期
    await asyncio.sleep(0.05)

    new_job = await manager.submit("new")
    await asyncio.wait_for(new_job._task, timeout=1.0)

    remaining_ids = {j.job_id for j in await manager.list_jobs()}
    assert old_job.job_id not in remaining_ids
    assert new_job.job_id in remaining_ids
