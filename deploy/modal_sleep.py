"""JARVIS Nocny Sen (Sleep-Time Compute) — lekki Modal Cron (CPU-only, zero kosztu GPU).

Uruchamiany codziennie o 03:00 UTC:
- pobiera zsynchronizowany stan (opcjonalnie z proxy /sync) lub przyjmuje payload przez endpoint,
- konsoliduje `open_loops` i `user_lessons`,
- przygotowuje max 30-sekundowy poranny briefing głosowy TYLKO jeśli są realnie pilne sprawy.

Deploy:
    modal deploy deploy/modal_sleep.py
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

import modal

APP_NAME = "jarvis-sleep"
app = modal.App(APP_NAME)
image = modal.Image.debian_slim(python_version="3.12")

OPEN_LOOP_RE = re.compile(
    r"(musz[ęe]|obieca[łl]em|obieca[łl]am|pami[ęe]taj[, ]+[żz]eby|wy[śs]l[ęe]|oddzwoni[ęe]|wr[óo][ćc]my do)\s+(.{6,140})",
    re.IGNORECASE,
)
CLOSE_LOOP_RE = re.compile(r"(za[łl]atwione|zrobione|wys[łl]a[łl]em|wys[łl]ane|oddzwoni[łl]em)", re.IGNORECASE)
HIGH_PRIO_RE = re.compile(r"(pilne|natychmiast|dzisiaj|dzi[śs]|jutro|faktur|umow|klient|termin)", re.IGNORECASE)


def sleep_consolidate_payload(data: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
    """Pure nocturnal consolidation matching src/lib/sleepCompute.ts and proxy/lib/cron.js."""
    now_ms = now_ms if now_ms is not None else int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    date_label = dt.datetime.fromtimestamp(now_ms / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")
    messages = data.get("recentMessages") or []

    loops: dict[str, dict[str, Any]] = {}
    for item in data.get("open_loops") or []:
        topic = str(item.get("topic") or "").strip()
        if topic:
            loops[topic.lower()[:64]] = dict(item)

    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "user":
            continue
        content = str(m.get("content") or "")
        if CLOSE_LOOP_RE.search(content):
            words = [w for w in re.split(r"\W+", content.lower()) if len(w) >= 4]
            for loop in loops.values():
                if loop.get("status") == "open" and any(w in str(loop.get("topic", "")).lower() for w in words):
                    loop["status"] = "closed"
                    loop["updatedAt"] = now_ms
        match = OPEN_LOOP_RE.search(content)
        if match:
            topic = re.split(r"[.!?\n]", match.group(2))[0].strip()[:60]
            if len(topic) >= 5 and topic.lower() not in loops:
                loops[topic.lower()] = {
                    "id": f"loop_{now_ms}_{len(loops)}",
                    "topic": topic,
                    "promise": f"{match.group(1).strip()} {topic}",
                    "priority": "high" if HIGH_PRIO_RE.search(content) else "medium",
                    "status": "open",
                    "createdAt": now_ms,
                    "updatedAt": now_ms,
                }

    open_loops = list(loops.values())[:40]
    urgent_items = [l["topic"] for l in open_loops if l.get("status") == "open" and l.get("priority") == "high"]
    urgent = len(urgent_items) > 0
    spoken = (
        f"Dzień dobry, masz {len(urgent_items)} pilne sprawy na dziś. Najważniejsze to {', '.join(urgent_items[:3])}. Od czego zaczynamy?"
        if urgent
        else None
    )
    return {
        "date": date_label,
        "consolidatedAt": now_ms,
        "open_loops": open_loops,
        "urgent": urgent,
        "spokenBriefing": spoken,
    }


@app.function(image=image, schedule=modal.Cron("0 3 * * *"), scaledown_window=60, timeout=120)
def nightly_sleep_cron() -> dict[str, Any]:
    """Scheduled 03:00 UTC health/consolidation heartbeat."""
    return sleep_consolidate_payload({})
