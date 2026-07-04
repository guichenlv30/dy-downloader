"""热榜数据采集模块。

仅负责数据落盘（JSONL），不下载媒体本体。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List

import aiofiles

from utils.logger import setup_logger

if TYPE_CHECKING:  # pragma: no cover
    from core.api_client import DouyinAPIClient

logger = setup_logger("Discovery")


async def _write_jsonl(path: Path, items: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        for item in items:
            await f.write(json.dumps(item, ensure_ascii=False))
            await f.write("\n")


async def dump_hot_board(
    api_client: "DouyinAPIClient",
    output_dir: Path,
    *,
    limit: int = 0,
) -> Dict[str, Any]:
    """抓取抖音热搜榜并写入 output_dir/hot_board/{ts}.jsonl。

    Args:
        limit: 上限（0=全部）
    Returns:
        dict(items, path)
    """
    page = await api_client.get_hot_search_board()
    items = list(page.get("items") or [])
    if limit and limit > 0:
        items = items[:limit]

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = output_dir / "hot_board" / f"{ts}.jsonl"
    await _write_jsonl(out_path, items)
    logger.info("Hot board snapshot saved: %s items -> %s", len(items), out_path)
    return {"items": items, "path": str(out_path), "count": len(items)}
