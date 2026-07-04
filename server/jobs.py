"""纯 Python 的后台下载任务模型，不依赖 FastAPI。

将 job 生命周期从 HTTP 层解耦，便于被 CLI 以外的入口复用（如未来的 MCP server）。
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set


def _now_iso() -> str:
    # 统一使用 timezone-aware UTC ISO-8601 字符串
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({SUCCESS, FAILED, CANCELLED})


class DownloadJob:
    def __init__(self, job_id: str, url: str, overrides: Optional[Dict[str, Any]] = None):
        self.job_id = job_id
        self.url = url
        self.overrides = dict(overrides or {})
        self.status = JobStatus.PENDING
        self.created_at = _now_iso()
        self.started_at: Optional[str] = None
        self.finished_at: Optional[str] = None
        # 单调时钟时间戳，用于 TTL / LRU 剪裁（不受系统时钟跳变影响）
        self.finished_monotonic: Optional[float] = None
        self.total = 0
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.error: Optional[str] = None
        self.step = ""
        self.detail = ""
        self.updated_at = self.created_at
        self.author_nickname: Optional[str] = None
        self.author_sec_uid: Optional[str] = None
        self._deleted = False
        self._task: Optional[asyncio.Task] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "url": self.url,
            "overrides": self.overrides,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "total": self.total,
            "success": self.success,
            "failed": self.failed,
            "skipped": self.skipped,
            "error": self.error,
            "step": self.step,
            "detail": self.detail,
            "updated_at": self.updated_at,
            "author_nickname": self.author_nickname,
            "author_sec_uid": self.author_sec_uid,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DownloadJob":
        job = cls(
            job_id=str(data.get("job_id") or uuid.uuid4().hex[:12]),
            url=str(data.get("url") or ""),
            overrides=data.get("overrides") or {},
        )
        job.status = str(data.get("status") or JobStatus.SUCCESS)
        job.created_at = str(data.get("created_at") or _now_iso())
        job.started_at = data.get("started_at")
        job.finished_at = data.get("finished_at")
        job.finished_monotonic = time.monotonic() if job.status in JobStatus.TERMINAL else None
        job.total = int(data.get("total") or 0)
        job.success = int(data.get("success") or 0)
        job.failed = int(data.get("failed") or 0)
        job.skipped = int(data.get("skipped") or 0)
        job.error = data.get("error")
        job.step = str(data.get("step") or "")
        job.detail = str(data.get("detail") or "")
        job.updated_at = str(data.get("updated_at") or job.finished_at or job.created_at)
        job.author_nickname = data.get("author_nickname")
        job.author_sec_uid = data.get("author_sec_uid")
        return job


class JobProgressReporter:
    """Adapter used by downloaders to update a DownloadJob in real time."""

    def __init__(self, job: DownloadJob, on_change: Optional[Callable[[], None]] = None):
        self.job = job
        self.on_change = on_change

    def _touch(self) -> None:
        self.job.updated_at = _now_iso()
        if self.on_change:
            self.on_change()

    def update_step(self, step: str, detail: str = "") -> None:
        self.job.step = str(step or "")
        if detail:
            self.job.detail = str(detail)
        self._touch()

    def set_item_total(self, total: int, detail: str = "") -> None:
        self.job.total = max(0, int(total or 0))
        if detail:
            self.job.detail = str(detail)
        self._touch()

    def advance_item(self, status: str, detail: str = "") -> None:
        normalized = str(status or "").lower()
        if normalized == "success":
            self.job.success += 1
        elif normalized == "failed":
            self.job.failed += 1
        elif normalized == "skipped":
            self.job.skipped += 1
        completed = self.job.success + self.job.failed + self.job.skipped
        if completed > self.job.total:
            self.job.total = completed
        if detail:
            self.job.detail = str(detail)
        self._touch()

    def on_author(
        self,
        nickname: Optional[str] = None,
        sec_uid: Optional[str] = None,
    ) -> None:
        if nickname:
            self.job.author_nickname = str(nickname)
        if sec_uid:
            self.job.author_sec_uid = str(sec_uid)
        self._touch()


class JobManager:
    """内存 job 存储 + 并发执行器，带 TTL + 容量上限。

    job 可通过 on_job_updated 回调持久化到外部存储。

    剪裁策略：
    - 每次 submit 前先剪裁一次：
        a. 丢弃 finished_monotonic 超过 job_ttl_seconds 的终态 job；
        b. 若剩余总数仍超过 max_jobs，按 finished_monotonic 升序淘汰最老的终态 job；
        c. in-flight（pending/running）job 永不淘汰。
    """

    DEFAULT_MAX_JOBS = 500
    DEFAULT_JOB_TTL_SECONDS = 24 * 3600  # 24 小时

    def __init__(
        self,
        executor: Callable[..., Awaitable[Dict[str, int]]],
        *,
        max_concurrency: int = 2,
        max_jobs: int = DEFAULT_MAX_JOBS,
        job_ttl_seconds: float = DEFAULT_JOB_TTL_SECONDS,
        on_job_updated: Optional[Callable[[DownloadJob], Awaitable[None]]] = None,
    ):
        self.executor = executor
        self.on_job_updated = on_job_updated
        self._jobs: Dict[str, DownloadJob] = {}
        self._semaphore = asyncio.Semaphore(max(1, max_concurrency))
        self._lock = asyncio.Lock()
        self._update_tasks: Dict[str, asyncio.Task] = {}
        self._pending_update_ids: Set[str] = set()
        self.max_jobs = max(1, int(max_jobs))
        self.job_ttl_seconds = max(0.0, float(job_ttl_seconds))

    async def submit(self, url: str, overrides: Optional[Dict[str, Any]] = None) -> DownloadJob:
        job_id = uuid.uuid4().hex[:12]
        job = DownloadJob(job_id=job_id, url=url, overrides=overrides)
        async with self._lock:
            self._prune_locked()
            self._jobs[job_id] = job
        await self._notify_job_updated(job)
        # 异步调度，立即返回 job 给调用方
        job._task = asyncio.create_task(self._run(job))
        return job

    async def _notify_job_updated(self, job: DownloadJob) -> None:
        if not self.on_job_updated or job._deleted:
            return
        try:
            await self.on_job_updated(job)
        except Exception:
            # Persistence failures must not change the download result. The
            # caller can still inspect the in-memory job during this process.
            pass

    def _schedule_job_updated(self, job: DownloadJob) -> None:
        if not self.on_job_updated or job._deleted:
            return
        existing = self._update_tasks.get(job.job_id)
        if existing is not None and not existing.done():
            self._pending_update_ids.add(job.job_id)
            return
        self._update_tasks[job.job_id] = asyncio.create_task(self._run_update_loop(job))

    async def _run_update_loop(self, job: DownloadJob) -> None:
        try:
            while True:
                self._pending_update_ids.discard(job.job_id)
                await self._notify_job_updated(job)
                if job.job_id not in self._pending_update_ids:
                    break
        finally:
            current = self._update_tasks.get(job.job_id)
            if current is asyncio.current_task():
                self._update_tasks.pop(job.job_id, None)
            self._pending_update_ids.discard(job.job_id)

    async def _flush_job_update(self, job: DownloadJob) -> None:
        task = self._update_tasks.get(job.job_id)
        if task is not None and task is not asyncio.current_task():
            await asyncio.gather(task, return_exceptions=True)

    def _prune_locked(self) -> None:
        """持锁内调用：按 TTL + 容量上限剪裁终态 job。"""
        now = time.monotonic()

        # 1) TTL
        if self.job_ttl_seconds > 0:
            expired_ids = [
                jid
                for jid, j in self._jobs.items()
                if j.status in JobStatus.TERMINAL
                and j.finished_monotonic is not None
                and (now - j.finished_monotonic) > self.job_ttl_seconds
            ]
            for jid in expired_ids:
                self._jobs.pop(jid, None)

        # 2) 容量上限：只淘汰终态 job，保留 in-flight
        if len(self._jobs) < self.max_jobs:
            return
        terminal_jobs = [
            (j.finished_monotonic or 0.0, jid)
            for jid, j in self._jobs.items()
            if j.status in JobStatus.TERMINAL
        ]
        terminal_jobs.sort(key=lambda pair: pair[0])
        overflow = len(self._jobs) - self.max_jobs + 1  # +1 是为新 job 腾位
        for _, jid in terminal_jobs[:overflow]:
            self._jobs.pop(jid, None)

    async def _run(self, job: DownloadJob) -> None:
        async with self._semaphore:
            job.status = JobStatus.RUNNING
            job.started_at = _now_iso()
            job.updated_at = job.started_at
            await self._notify_job_updated(job)
            reporter = JobProgressReporter(job, on_change=lambda: self._schedule_job_updated(job))
            try:
                counts = await self.executor(job.url, job.overrides, reporter, job.job_id)
                for key in ("total", "success", "failed", "skipped"):
                    if key in counts and counts[key] is not None:
                        setattr(job, key, int(counts[key]))
                # 只要跑完就是 success；具体成功/失败个数通过字段区分
                job.status = JobStatus.SUCCESS if job.failed == 0 else JobStatus.FAILED
            except asyncio.CancelledError:
                job.status = JobStatus.CANCELLED
                job.error = "cancelled"
                raise
            except Exception as exc:
                job.status = JobStatus.FAILED
                job.error = f"{type(exc).__name__}: {exc}"
            finally:
                await self._flush_job_update(job)
                job.finished_at = _now_iso()
                job.updated_at = job.finished_at
                job.finished_monotonic = time.monotonic()
                await self._notify_job_updated(job)

    async def get(self, job_id: str) -> Optional[DownloadJob]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def list_jobs(self) -> List[DownloadJob]:
        async with self._lock:
            return list(self._jobs.values())

    async def delete(self, job_id: str) -> bool:
        async with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            return False
        job._deleted = True
        if job._task is not None and not job._task.done():
            job._task.cancel()
        return True

    async def clear_terminal(self) -> int:
        async with self._lock:
            removable_ids = [
                job_id
                for job_id, job in self._jobs.items()
                if job.status in JobStatus.TERMINAL
            ]
            for job_id in removable_ids:
                self._jobs.pop(job_id, None)
        return len(removable_ids)

    async def restore(self, rows: List[Dict[str, Any]]) -> None:
        """Restore terminal jobs from persistent storage."""
        async with self._lock:
            for row in rows:
                job = DownloadJob.from_dict(row)
                if job.status in JobStatus.TERMINAL and job.job_id not in self._jobs:
                    self._jobs[job.job_id] = job
            self._prune_locked()

    async def shutdown(self) -> None:
        """等待所有 pending/running 任务结束。"""
        tasks = [j._task for j in self._jobs.values() if j._task is not None]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        update_tasks = list(self._update_tasks.values())
        if update_tasks:
            await asyncio.gather(*update_tasks, return_exceptions=True)
