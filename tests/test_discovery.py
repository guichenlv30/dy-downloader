"""热榜落盘模块测试。"""

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from core.discovery import dump_hot_board


class _FakeAPIClient:
    def __init__(
        self,
        hot_items: List[Dict[str, Any]] | None = None,
    ):
        self._hot_items = hot_items or []

    async def get_hot_search_board(self) -> Dict[str, Any]:
        return {
            "items": self._hot_items,
            "has_more": False,
            "max_cursor": 0,
        }


@pytest.mark.asyncio
async def test_dump_hot_board_writes_jsonl(tmp_path):
    api = _FakeAPIClient(
        hot_items=[{"word": "foo", "hot_value": 100}, {"word": "bar", "hot_value": 50}]
    )
    result = await dump_hot_board(api, tmp_path)
    assert result["count"] == 2
    out = Path(result["path"])
    assert out.exists()
    lines = out.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["word"] == "foo"


@pytest.mark.asyncio
async def test_dump_hot_board_respects_limit(tmp_path):
    api = _FakeAPIClient(hot_items=[{"word": f"w{i}"} for i in range(20)])
    result = await dump_hot_board(api, tmp_path, limit=5)
    assert result["count"] == 5
