"""Browser-based login flow for the REST UI.

The user completes Douyin login in a visible Playwright browser while this
module concurrently observes requests and polls browser storage for cookies.
Once a real session cookie appears, cookies are saved through CookieManager.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from auth import CookieManager
from tools.cookie_fetcher import (
    DEFAULT_URL,
    extract_ms_token_from_text,
    filter_cookies,
    try_extract_ms_token,
)
from utils.cookie_utils import parse_cookie_header, sanitize_cookies

REQUIRED_COOKIE_KEYS = {"ttwid", "odin_tt", "passport_csrf_token"}
SESSION_COOKIE_KEYS = {
    "sessionid",
    "sessionid_ss",
    "uid_tt",
    "uid_tt_ss",
}
WEAK_SESSION_COOKIE_KEYS = {
    "sid_guard",
    "sid_tt",
    "passport_auth_status",
    "passport_auth_status_ss",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def cookie_state(cookies: Dict[str, str]) -> Dict[str, Any]:
    clean = sanitize_cookies(cookies or {})
    present = sorted(key for key, value in clean.items() if value)
    missing_required = sorted(key for key in REQUIRED_COOKIE_KEYS if not clean.get(key))
    session_keys = sorted(key for key in SESSION_COOKIE_KEYS if clean.get(key))
    weak_session_keys = sorted(key for key in WEAK_SESSION_COOKIE_KEYS if clean.get(key))
    return {
        "present": bool(present),
        "count": len(present),
        "required_present": not missing_required,
        "missing_required": missing_required,
        "session_present": bool(session_keys),
        "session_keys": session_keys,
        "weak_session_keys": weak_session_keys,
        "auth_ready": bool(session_keys) and not missing_required,
    }


class BrowserLoginSession:
    def __init__(self, login_url: str, timeout_seconds: int):
        self.login_id = uuid4().hex[:12]
        self.login_url = login_url
        self.timeout_seconds = timeout_seconds
        self.status = "running"
        self.started_at = _now_iso()
        self.finished_at: Optional[str] = None
        self.error: Optional[str] = None
        self.message = "浏览器已打开，请在抖音完成登录"
        self.cookie_count = 0
        self.required_present = False
        self.session_present = False
        self.missing_required = sorted(REQUIRED_COOKIE_KEYS)
        self.saved_cookie_file = ""
        self._task: Optional[asyncio.Task] = None
        self._browser: Any = None
        self._context: Any = None

    def update_cookie_state(self, cookies: Dict[str, str]) -> None:
        state = cookie_state(cookies)
        self.cookie_count = int(state["count"])
        self.required_present = bool(state["required_present"])
        self.session_present = bool(state["session_present"])
        self.missing_required = list(state["missing_required"])

    def to_dict(self) -> Dict[str, Any]:
        return {
            "login_id": self.login_id,
            "login_url": self.login_url,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "message": self.message,
            "cookie_count": self.cookie_count,
            "required_present": self.required_present,
            "session_present": self.session_present,
            "missing_required": self.missing_required,
            "saved_cookie_file": self.saved_cookie_file,
        }


class BrowserLoginManager:
    def __init__(
        self,
        cookie_manager: CookieManager,
        *,
        proxy: str = "",
        profile_dir: str = "",
    ):
        self.cookie_manager = cookie_manager
        self.proxy = str(proxy or "").strip()
        self.profile_dir = str(profile_dir or "").strip()
        self._lock = asyncio.Lock()
        self._session: Optional[BrowserLoginSession] = None

    async def start(
        self,
        *,
        login_url: str = DEFAULT_URL,
        timeout_seconds: int = 300,
    ) -> Dict[str, Any]:
        async with self._lock:
            if self._session and self._session.status == "running":
                return self._session.to_dict()
            self._session = BrowserLoginSession(
                login_url=login_url or DEFAULT_URL,
                timeout_seconds=max(30, min(int(timeout_seconds or 300), 900)),
            )
            self._session._task = asyncio.create_task(self._run(self._session))
            return self._session.to_dict()

    async def status(self) -> Dict[str, Any]:
        async with self._lock:
            if not self._session:
                return {
                    "status": "idle",
                    "message": "未开始登录",
                    "cookie_count": 0,
                    "required_present": False,
                    "session_present": False,
                    "missing_required": sorted(REQUIRED_COOKIE_KEYS),
                    "saved_cookie_file": str(self.cookie_manager.cookie_file),
                }
            return self._session.to_dict()

    async def cancel(self) -> Dict[str, Any]:
        async with self._lock:
            session = self._session
        if not session or session.status != "running":
            return await self.status()
        session.status = "cancelled"
        session.message = "登录已取消"
        session.finished_at = _now_iso()
        if session._task and not session._task.done():
            session._task.cancel()
        await self._close_browser(session)
        return session.to_dict()

    async def shutdown(self) -> None:
        async with self._lock:
            session = self._session
        if not session:
            return
        if session._task and not session._task.done():
            session._task.cancel()
        await self._close_browser(session)

    async def _run(self, session: BrowserLoginSession) -> None:
        observed_cookie_headers: List[str] = []
        observed_mstokens: List[str] = []
        try:
            try:
                from playwright.async_api import async_playwright  # type: ignore
            except ImportError as exc:
                raise RuntimeError(
                    "Playwright 未安装，请先执行：pip install playwright && python -m playwright install chromium"
                ) from exc

            async with async_playwright() as playwright:
                launch_kwargs: Dict[str, Any] = {"headless": False}
                if self.proxy:
                    launch_kwargs["proxy"] = {"server": self.proxy}
                if self.profile_dir:
                    Path(self.profile_dir).mkdir(parents=True, exist_ok=True)
                    context = await playwright.chromium.launch_persistent_context(
                        self.profile_dir,
                        **launch_kwargs,
                        locale="zh-CN",
                        viewport={"width": 1280, "height": 820},
                    )
                    browser = context.browser
                else:
                    browser = await playwright.chromium.launch(**launch_kwargs)
                    context = await browser.new_context(
                        locale="zh-CN",
                        viewport={"width": 1280, "height": 820},
                    )
                page = await context.new_page()
                session._browser = browser
                session._context = context

                def _on_request(request: Any) -> None:
                    try:
                        headers = request.headers or {}
                        cookie_header = headers.get("cookie")
                        if cookie_header:
                            observed_cookie_headers.append(cookie_header)
                        query = parse_qs(urlparse(request.url or "").query)
                        if query.get("msToken"):
                            observed_mstokens.append((query["msToken"][0] or "").strip())
                        token = extract_ms_token_from_text(request.url or "")
                        if token:
                            observed_mstokens.append(token)
                    except Exception:
                        return

                page.on("request", _on_request)
                try:
                    await page.goto(session.login_url, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    session.message = "页面仍在加载，请继续在浏览器中完成登录"

                deadline = asyncio.get_running_loop().time() + session.timeout_seconds
                while asyncio.get_running_loop().time() < deadline:
                    cookies = await self._collect_cookies(
                        context,
                        page,
                        observed_cookie_headers,
                        observed_mstokens,
                    )
                    session.update_cookie_state(cookies)
                    if session.session_present and session.required_present:
                        self.cookie_manager.set_cookies(cookies)
                        session.status = "success"
                        session.saved_cookie_file = str(self.cookie_manager.cookie_file)
                        session.message = "登录 Cookie 已保存"
                        session.finished_at = _now_iso()
                        return
                    session.message = (
                        "等待抖音登录完成，后台正在实时提取 Cookie"
                        if session.cookie_count
                        else "等待抖音登录完成"
                    )
                    await asyncio.sleep(1)

                raise TimeoutError("登录超时，请重新点击一键登录")
        except asyncio.CancelledError:
            if session.status == "running":
                session.status = "cancelled"
                session.message = "登录已取消"
                session.finished_at = _now_iso()
            raise
        except Exception as exc:
            if session.status == "running":
                session.status = "failed"
                session.error = f"{type(exc).__name__}: {exc}"
                session.message = "登录失败"
                session.finished_at = _now_iso()
        finally:
            await self._close_browser(session)

    async def _collect_cookies(
        self,
        context: Any,
        page: Any,
        observed_cookie_headers: List[str],
        observed_mstokens: List[str],
    ) -> Dict[str, str]:
        storage = await context.storage_state()
        raw_cookies = {
            cookie["name"]: cookie["value"]
            for cookie in storage.get("cookies", [])
            if str(cookie.get("domain") or "").endswith("douyin.com")
        }
        raw_cookies = sanitize_cookies(raw_cookies)

        ms_token = await try_extract_ms_token(
            page,
            raw_cookies,
            observed_cookie_headers,
            observed_mstokens,
        )
        if ms_token and not raw_cookies.get("msToken"):
            raw_cookies["msToken"] = ms_token

        for header in reversed(observed_cookie_headers[-20:]):
            parsed = parse_cookie_header(header)
            for key in SESSION_COOKIE_KEYS | REQUIRED_COOKIE_KEYS | {"msToken"}:
                if parsed.get(key) and not raw_cookies.get(key):
                    raw_cookies[key] = parsed[key]

        picked = filter_cookies(raw_cookies)
        for key in SESSION_COOKIE_KEYS | WEAK_SESSION_COOKIE_KEYS:
            if raw_cookies.get(key):
                picked[key] = raw_cookies[key]
        return sanitize_cookies(picked)

    async def _close_browser(self, session: BrowserLoginSession) -> None:
        context = session._context
        browser = session._browser
        session._context = None
        session._browser = None
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass
