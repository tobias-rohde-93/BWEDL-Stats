import json
import os
import shutil
import stat
import tempfile
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


def validate_promotion_paths(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise ValueError(f"source must not be a symlink: {source}")
    try:
        source_mode = source.stat().st_mode
    except FileNotFoundError as error:
        raise FileNotFoundError(f"source does not exist: {source}") from error
    if not stat.S_ISREG(source_mode):
        raise ValueError(f"source must be a regular file: {source}")

    if destination.is_symlink():
        raise ValueError(f"destination must not be a symlink: {destination}")
    try:
        destination_mode = destination.stat().st_mode
    except FileNotFoundError:
        return
    if not stat.S_ISREG(destination_mode):
        raise ValueError(f"destination must be a regular file: {destination}")


def promote_file(source: Path, destination: Path) -> None:
    validate_promotion_paths(source, destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.next-",
        dir=destination.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copyfile(source, temporary_path)
        os.replace(temporary_path, destination)
    finally:
        temporary_path.unlink(missing_ok=True)


def content_changed(source: Path, destination: Path) -> bool:
    validate_promotion_paths(source, destination)
    return not destination.exists() or source.read_bytes() != destination.read_bytes()
