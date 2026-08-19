from __future__ import annotations

import os
import stat
import tempfile
from collections.abc import Callable
from pathlib import Path, PureWindowsPath

from pipeline.files import content_changed, promote_file, validate_promotion_paths
from pipeline.validation import Decision, ValidationResult


DOMAIN_FILES = {
    "leagues": ("league_data.json", "league_data.js"),
    "rankings": ("ranking_data.json", "ranking_data.js"),
    "clubs": ("club_data.json", "club_data.js"),
    "archives": ("archive_data.js", "archive_tables.js"),
}


class PublicationError(RuntimeError):
    """Raised when publication fails and the prior state cannot be restored."""


def _restore_destination_original(destination: Path, previous: bytes | None) -> None:
    if previous is None:
        destination.unlink(missing_ok=True)
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, rollback_name = tempfile.mkstemp(
        prefix=f".{destination.name}.rollback-",
        dir=destination.parent,
    )
    rollback_path = Path(rollback_name)
    try:
        with os.fdopen(descriptor, "wb") as rollback_file:
            rollback_file.write(previous)
        os.replace(rollback_path, destination)
    finally:
        rollback_path.unlink(missing_ok=True)


_restore_destination = _restore_destination_original


def _rollback_transaction(
    destinations: list[Path], snapshots: dict[Path, bytes | None]
) -> list[str]:
    failures: list[str] = []
    for destination in destinations:
        try:
            _restore_destination(destination, snapshots[destination])
        except Exception as restore_error:
            failures.append(f"{destination.name}: {restore_error}")
    return failures


def _has_reparse_point(path: Path) -> bool:
    try:
        path_stat = path.lstat()
    except FileNotFoundError:
        return False
    return stat.S_ISLNK(path_stat.st_mode) or bool(
        getattr(path_stat, "st_file_attributes", 0) & 0x400
    )


def _validate_safe_path_components(path: Path, label: str) -> None:
    absolute_path = Path(os.path.abspath(path))
    for component in (absolute_path, *absolute_path.parents):
        if _has_reparse_point(component):
            raise ValueError(f"{label} must not contain a symlink or reparse point: {path}")


def _validate_directory(path: Path, label: str, *, allow_missing: bool) -> bool:
    _validate_safe_path_components(path, label)
    try:
        path_stat = path.lstat()
    except FileNotFoundError:
        if allow_missing:
            return False
        raise FileNotFoundError(f"{label} does not exist: {path}") from None
    if _has_reparse_point(path) or not stat.S_ISDIR(path_stat.st_mode):
        raise ValueError(f"{label} must be a real directory: {path}")
    return True


def _validate_direct_child(root: Path, child: Path, label: str) -> None:
    absolute_root = Path(os.path.abspath(root))
    absolute_child = Path(os.path.abspath(child))
    if absolute_child.parent != absolute_root:
        raise ValueError(f"{label} escapes its publication root: {child}")


def _safe_basename(name: object, label: str) -> str:
    windows_name = PureWindowsPath(name) if isinstance(name, str) else None
    if (
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        or Path(name).is_absolute()
        or Path(name).name != name
        or windows_name is not None and bool(windows_name.drive or windows_name.root)
        or name.endswith((".", " "))
    ):
        raise ValueError(f"invalid {label}: {name!r}")
    return name


def _target_key(name: str) -> str:
    return name.casefold()


def _owned_regular_children(directory: Path, root: Path, label: str) -> list[Path]:
    try:
        children = sorted(directory.iterdir(), key=lambda child: child.name)
    except OSError as error:
        raise ValueError(f"could not inspect {label}: {directory}") from error

    seen_target_keys: set[str] = set()
    for child in children:
        _validate_direct_child(root, child, label)
        _validate_safe_path_components(child, label)
        child_name = _safe_basename(child.name, f"{label} child")
        target_key = _target_key(child_name)
        if target_key in seen_target_keys:
            raise ValueError(f"{label} contains colliding child aliases: {child}")
        seen_target_keys.add(target_key)
        try:
            child_stat = child.lstat()
        except FileNotFoundError as error:
            raise ValueError(f"{label} changed during preflight: {child}") from error
        if _has_reparse_point(child) or not stat.S_ISREG(child_stat.st_mode):
            raise ValueError(f"{label} children must be regular files: {child}")
    return children


def _validate_owned_directory(
    staging: Path, published: Path, name: str
) -> tuple[list[Path], list[Path], bool]:
    source = staging / name
    destination = published / name
    _validate_direct_child(staging, source, "owned directory source")
    _validate_direct_child(published, destination, "owned directory destination")
    _validate_directory(source, "owned directory source", allow_missing=False)
    destination_existed = _validate_directory(
        destination, "owned directory destination", allow_missing=True
    )
    source_children = _owned_regular_children(source, source, "owned directory source")
    destination_children = (
        _owned_regular_children(destination, destination, "owned directory destination")
        if destination_existed
        else []
    )
    return source_children, destination_children, destination_existed


def _rollback_created_directories(directories: list[Path]) -> list[str]:
    failures: list[str] = []
    for directory in reversed(directories):
        try:
            directory.rmdir()
        except FileNotFoundError:
            continue
        except OSError as error:
            failures.append(f"{directory.name}: {error}")
    return failures


def publish_domains(
    staging: Path,
    published: Path,
    results: list[ValidationResult],
    *,
    additional_files: tuple[str, ...] = (),
    additional_directories: tuple[str, ...] = (),
    finalize: Callable[[list[Path]], None] | None = None,
) -> list[Path]:
    domain_filenames = {name for names in DOMAIN_FILES.values() for name in names}
    domain_target_keys = {_target_key(name) for name in domain_filenames}
    seen_additional_target_keys: set[str] = set()
    for filename in additional_files:
        _safe_basename(filename, "additional publication file")
        target_key = _target_key(filename)
        if target_key in seen_additional_target_keys or target_key in domain_target_keys:
            raise ValueError(f"invalid additional publication file: {filename!r}")
        seen_additional_target_keys.add(target_key)

    seen_directories: set[str] = set()
    seen_directory_target_keys: set[str] = set()
    for directory in additional_directories:
        _safe_basename(directory, "additional publication directory")
        target_key = _target_key(directory)
        if target_key in seen_directory_target_keys:
            raise ValueError(f"invalid additional publication directory: {directory!r}")
        if target_key in domain_target_keys or target_key in seen_additional_target_keys:
            raise ValueError(f"additional publication directory collision: {directory!r}")
        seen_directories.add(directory)
        seen_directory_target_keys.add(target_key)

    indexed_results: dict[str, ValidationResult] = {}
    for result in results:
        if not isinstance(result.domain, str) or result.domain not in DOMAIN_FILES:
            raise ValueError(f"unknown publication domain: {result.domain}")
        if result.domain in indexed_results:
            raise ValueError(f"duplicate publication domain: {result.domain}")
        indexed_results[result.domain] = result

    _validate_directory(staging, "staging root", allow_missing=False)
    _validate_directory(published, "published root", allow_missing=True)

    candidates: list[tuple[Path, Path]] = []
    for domain, filenames in DOMAIN_FILES.items():
        result = indexed_results.get(domain)
        if result is None or result.decision is not Decision.PUBLISH:
            continue
        for filename in filenames:
            source = staging / filename
            destination = published / filename
            _validate_direct_child(staging, source, "domain source")
            _validate_direct_child(published, destination, "domain destination")
            validate_promotion_paths(source, destination)
            candidates.append((source, destination))
    for filename in additional_files:
        source = staging / filename
        destination = published / filename
        _validate_direct_child(staging, source, "additional source")
        _validate_direct_child(published, destination, "additional destination")
        validate_promotion_paths(source, destination)
        candidates.append((source, destination))

    directory_promotions: list[tuple[Path, Path]] = []
    directory_deletions: list[Path] = []
    missing_owned_directories: list[Path] = []
    for directory in sorted(seen_directories):
        source_children, destination_children, destination_existed = _validate_owned_directory(
            staging, published, directory
        )
        destination_by_name = {child.name: child for child in destination_children}
        source_names = {child.name for child in source_children}
        for source in source_children:
            destination = published / directory / source.name
            validate_promotion_paths(source, destination)
            if content_changed(source, destination):
                directory_promotions.append((source, destination))
        directory_deletions.extend(
            destination_by_name[name]
            for name in sorted(set(destination_by_name) - source_names)
        )
        if not destination_existed and source_children:
            missing_owned_directories.append(published / directory)

    changed_promotions = [
        (source, destination)
        for source, destination in candidates
        if content_changed(source, destination)
    ]
    changed_promotions.extend(directory_promotions)
    changed_destinations = [
        *(destination for _, destination in changed_promotions),
        *directory_deletions,
    ]
    if not changed_destinations:
        if finalize is not None:
            finalize([])
        return []

    snapshots = {
        destination: destination.read_bytes() if destination.exists() else None
        for destination in changed_destinations
    }
    created_directories = [
        directory
        for directory in missing_owned_directories
        if any(destination.parent == directory for _, destination in changed_promotions)
    ]

    try:
        for source, destination in changed_promotions:
            promote_file(source, destination)
        for destination in directory_deletions:
            destination.unlink()
        if finalize is not None:
            finalize(changed_destinations)
    except Exception as original_error:
        restoration_failures = _rollback_transaction(changed_destinations, snapshots)
        restoration_failures.extend(_rollback_created_directories(created_directories))
        if restoration_failures:
            details = "; ".join(restoration_failures)
            raise PublicationError(
                f"publication failed and rollback was incomplete: {details}"
            ) from original_error
        raise

    return changed_destinations
