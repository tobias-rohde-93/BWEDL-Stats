import json
import os
import shutil
from pathlib import Path
from typing import Any


def write_json_pair(
    output_dir: Path,
    stem: str,
    global_name: str,
    payload: dict[str, Any],
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{stem}.json"
    javascript_path = output_dir / f"{stem}.js"

    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    javascript_path.write_text(
        f"window.{global_name} = {json.dumps(payload, ensure_ascii=False)};\n",
        encoding="utf-8",
        newline="\n",
    )

    return json_path, javascript_path


def promote_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    next_path = destination.with_suffix(destination.suffix + ".next")
    try:
        shutil.copyfile(source, next_path)
        os.replace(next_path, destination)
    finally:
        next_path.unlink(missing_ok=True)


def content_changed(source: Path, destination: Path) -> bool:
    return not destination.exists() or source.read_bytes() != destination.read_bytes()
