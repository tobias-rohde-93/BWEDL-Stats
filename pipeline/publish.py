from __future__ import annotations

import os
import stat
import tempfile
import warnings
from collections.abc import Callable
from dataclasses import dataclass
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


@dataclass(frozen=True)
class _PathState:
    exists: bool
    contents: bytes | None
    identity: tuple[int, int, int, int, int] | None


@dataclass(frozen=True)
class _JournalEntry:
    destination: Path
    before: _PathState
    after: _PathState


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
        or ":" in name
        or any(ord(character) < 32 or ord(character) == 127 for character in name)
        or name.split(".", 1)[0].casefold().translate(str.maketrans("¹²³", "123"))
        in {"con", "prn", "aux", "nul", *(f"com{number}" for number in range(1, 10)), *(f"lpt{number}" for number in range(1, 10))}
    ):
        raise ValueError(f"invalid {label}: {name!r}")
    return name


def _target_key(name: str) -> str:
    return name.casefold()


def _identity(path_stat: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        path_stat.st_dev,
        path_stat.st_ino,
        stat.S_IFMT(path_stat.st_mode),
        path_stat.st_size,
        path_stat.st_mtime_ns,
    )


def _target_state(path: Path) -> _PathState:
    try:
        path_stat = path.lstat()
    except FileNotFoundError:
        return _PathState(False, None, None)
    if _has_reparse_point(path) or not stat.S_ISREG(path_stat.st_mode):
        raise ValueError(f"publication target must be a regular non-reparse file: {path}")
    return _PathState(True, path.read_bytes(), _identity(path_stat))


def _directory_state(path: Path) -> tuple[int, int, int] | None:
    try:
        path_stat = path.lstat()
    except FileNotFoundError:
        return None
    if _has_reparse_point(path) or not stat.S_ISDIR(path_stat.st_mode):
        raise ValueError(f"publication parent must be a real directory: {path}")
    return (path_stat.st_dev, path_stat.st_ino, stat.S_IFMT(path_stat.st_mode))


def _assert_state(path: Path, expected: _PathState) -> None:
    # Trusted, serialized publishers use these identity gates plus frozen sources;
    # they detect ordinary races but are not a kernel-enforced adversarial swap guard.
    if _target_state(path) != expected:
        raise ValueError(f"publication target changed since preflight: {path}")


def _assert_parent_states(states: dict[Path, tuple[int, int, int] | None]) -> None:
    for parent, expected in states.items():
        if _directory_state(parent) != expected:
            raise ValueError(f"publication parent changed since preflight: {parent}")


def _refresh_created_parent_states(
    states: dict[Path, tuple[int, int, int] | None]
) -> None:
    for parent, expected in states.items():
        if expected is None and parent.exists():
            states[parent] = _directory_state(parent)


def _owned_regular_children(directory: Path, root: Path, label: str) -> dict[str, Path]:
    try:
        children = sorted(directory.iterdir(), key=lambda child: child.name)
    except OSError as error:
        raise ValueError(f"could not inspect {label}: {directory}") from error

    inventory: dict[str, Path] = {}
    for child in children:
        _validate_direct_child(root, child, label)
        _validate_safe_path_components(child, label)
        child_name = _safe_basename(child.name, f"{label} child")
        target_key = _target_key(child_name)
        if target_key in inventory:
            raise ValueError(f"{label} contains colliding child aliases: {child}")
        try:
            child_stat = child.lstat()
        except FileNotFoundError as error:
            raise ValueError(f"{label} changed during preflight: {child}") from error
        if _has_reparse_point(child) or not stat.S_ISREG(child_stat.st_mode):
            raise ValueError(f"{label} children must be regular files: {child}")
        inventory[target_key] = child
    return inventory


def _validate_owned_directory(
    staging: Path, published: Path, name: str
) -> tuple[dict[str, Path], dict[str, Path], bool]:
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
        else {}
    )
    return source_children, destination_children, destination_existed


def _mutation_target_key(destination: Path) -> str:
    return str(Path(os.path.abspath(destination))).casefold()


def _validate_unique_mutation_targets(destinations: list[Path]) -> None:
    seen_targets: dict[str, Path] = {}
    for destination in destinations:
        target_key = _mutation_target_key(destination)
        if target_key in seen_targets:
            raise ValueError(
                "publication contains colliding mutation targets: "
                f"{seen_targets[target_key]} and {destination}"
            )
        seen_targets[target_key] = destination


def _create_destination_directories(
    directories: list[Path],
    parent_states: dict[Path, tuple[int, int, int] | None],
) -> list[tuple[Path, tuple[int, int, int]]]:
    created: list[tuple[Path, tuple[int, int, int]]] = []
    for directory in sorted(directories, key=lambda path: len(path.parts)):
        if _directory_state(directory) is not None:
            continue
        parent = directory.parent
        if parent in parent_states and parent_states[parent] != _directory_state(parent):
            raise ValueError(f"publication parent changed since preflight: {parent}")
        try:
            directory.mkdir(exist_ok=False)
        except FileExistsError as error:
            raise ValueError(f"publication directory appeared since preflight: {directory}") from error
        identity = _directory_state(directory)
        assert identity is not None
        parent_states[directory] = identity
        created.append((directory, identity))
    return created


def _rollback_created_directories(
    directories: list[tuple[Path, tuple[int, int, int]]]
) -> list[str]:
    failures: list[str] = []
    for directory, identity in reversed(directories):
        try:
            if _directory_state(directory) != identity:
                raise ValueError("directory was replaced after publisher creation")
            directory.rmdir()
        except FileNotFoundError:
            continue
        except OSError as error:
            failures.append(f"{directory}: {error}")
    return failures


def _rollback_journal(
    journal: list[_JournalEntry],
    parent_states: dict[Path, tuple[int, int, int] | None],
    published: Path,
) -> list[str]:
    failures: list[str] = []
    for entry in reversed(journal):
        try:
            parent = entry.destination.parent
            if _directory_state(parent) != parent_states[parent]:
                raise ValueError(f"publication parent changed since preflight: {parent}")
            if _target_state(entry.destination) != entry.after:
                raise ValueError("target was replaced after publisher mutation")
            _restore_destination(entry.destination, entry.before.contents)
        except Exception as restore_error:
            try:
                relative = entry.destination.relative_to(published)
            except ValueError:
                relative = entry.destination
            failures.append(f"{relative}: {restore_error}")
    return failures


def _freeze_sources(
    changed: list[tuple[Path, Path]], source_states: dict[Path, _PathState]
) -> tuple[list[tuple[Path, Path]], list[Path]]:
    frozen: list[tuple[Path, Path]] = []
    temporary_paths: list[Path] = []
    try:
        for source, destination in changed:
            state = source_states[source]
            if _target_state(source) != state or not state.exists or state.contents is None:
                raise ValueError(f"publication source changed during preflight: {source}")
            descriptor, temporary_name = tempfile.mkstemp(prefix="publisher-source-")
            temporary = Path(temporary_name)
            with os.fdopen(descriptor, "wb") as temporary_file:
                temporary_file.write(state.contents)
            temporary_paths.append(temporary)
            frozen.append((temporary, destination))
    except Exception:
        for temporary in temporary_paths:
            temporary.unlink(missing_ok=True)
        raise
    return frozen, temporary_paths


def _cleanup_frozen_sources(temporary_sources: list[Path]) -> None:
    failures: list[str] = []
    for temporary_source in temporary_sources:
        try:
            temporary_source.unlink(missing_ok=True)
        except OSError as error:
            failures.append(str(error))
    if failures:
        warnings.warn(
            f"publication committed/rolled back but frozen source cleanup failed: {'; '.join(failures)}",
            RuntimeWarning,
            stacklevel=2,
        )


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

    if (
        not additional_files
        and not additional_directories
        and not any(result.decision is Decision.PUBLISH for result in indexed_results.values())
    ):
        if finalize is not None:
            finalize([])
        return []

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
        for target_key, source in source_children.items():
            destination = destination_children.get(
                target_key, published / directory / source.name
            )
            validate_promotion_paths(source, destination)
            if content_changed(source, destination):
                directory_promotions.append((source, destination))
        directory_deletions.extend(
            destination
            for target_key, destination in destination_children.items()
            if target_key not in source_children
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
    _validate_unique_mutation_targets(changed_destinations)
    if not changed_destinations:
        if finalize is not None:
            finalize([])
        return []

    snapshots = {destination: _target_state(destination) for destination in changed_destinations}
    parent_states = {
        parent: _directory_state(parent)
        for parent in {
            published,
            *(destination.parent for _, destination in changed_promotions),
            *(destination.parent for destination in directory_deletions),
        }
    }
    source_states = {source: _target_state(source) for source, _ in changed_promotions}
    frozen_promotions, temporary_sources = _freeze_sources(changed_promotions, source_states)
    created_directories: list[tuple[Path, tuple[int, int, int]]] = []

    journal: list[_JournalEntry] = []
    try:
        created_directories = _create_destination_directories(
            [parent for parent, identity in parent_states.items() if identity is None],
            parent_states,
        )
        for source, destination in frozen_promotions:
            _assert_parent_states(parent_states)
            before = snapshots[destination]
            _assert_state(destination, before)
            try:
                promote_file(source, destination)
            except Exception:
                after = _target_state(destination)
                if after != before:
                    journal.append(_JournalEntry(destination, before, after))
                raise
            after = _target_state(destination)
            journal.append(_JournalEntry(destination, before, after))
            _refresh_created_parent_states(parent_states)
        for destination in directory_deletions:
            _assert_parent_states(parent_states)
            before = snapshots[destination]
            _assert_state(destination, before)
            try:
                destination.unlink()
            except Exception:
                after = _target_state(destination)
                if after != before:
                    journal.append(_JournalEntry(destination, before, after))
                raise
            journal.append(_JournalEntry(destination, before, _target_state(destination)))
        if finalize is not None:
            finalize(list(changed_destinations))
    except Exception as original_error:
        restoration_failures = _rollback_journal(journal, parent_states, published)
        restoration_failures.extend(_rollback_created_directories(created_directories))
        if restoration_failures:
            details = "; ".join(restoration_failures)
            raise PublicationError(
                f"publication failed and rollback was incomplete: {details}"
            ) from original_error
        raise
    finally:
        _cleanup_frozen_sources(temporary_sources)

    return list(changed_destinations)
