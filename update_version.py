#!/usr/bin/env python3
"""Update NexTerm's web version using the local timezone.

The format is YY.MONTH.DAYHH, for example 26.9.118 (2026-09-01 18:00)
or 26.10.1109 (2026-10-11 09:00).
"""

from datetime import datetime
import json
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parent
VERSION_FILE = ROOT / "public" / "version.json"


def build_version(now: Optional[datetime] = None) -> str:
    current = now or datetime.now().astimezone()
    return f"{current.year % 100:02d}.{current.month}.{current.day}{current.hour:02d}"


def main() -> None:
    version = build_version()
    VERSION_FILE.write_text(
        json.dumps({"version": version}, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"NexTerm web version updated to {version}")


if __name__ == "__main__":
    main()
