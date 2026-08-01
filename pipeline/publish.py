from __future__ import annotations

import os
import tempfile
from pathlib import Path

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


def publish_domains(
    staging: Path,
    published: Path,
    results: list[ValidationResult],
    *,
    additional_files: tuple[str, ...] = (),
) -> list[Path]:
    domain_filenames = {name for names in DOMAIN_FILES.values() for name in names}
    seen_additional: set[str] = set()
    for filename in additional_files:
        if (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
            or filename in seen_additional
            or filename in domain_filenames
        ):
            raise ValueError(f"invalid additional publication file: {filename!r}")
        seen_additional.add(filename)

    indexed_results: dict[str, ValidationResult] = {}
    for result in results:
        if not isinstance(result.domain, str) or result.domain not in DOMAIN_FILES:
            raise ValueError(f"unknown publication domain: {result.domain}")
        if result.domain in indexed_results:
            raise ValueError(f"duplicate publication domain: {result.domain}")
        indexed_results[result.domain] = result

    candidates: list[tuple[Path, Path]] = []
    for domain, filenames in DOMAIN_FILES.items():
        result = indexed_results.get(domain)
        if result is None or result.decision is not Decision.PUBLISH:
            continue
        for filename in filenames:
            source = staging / filename
            destination = published / filename
            validate_promotion_paths(source, destination)
            candidates.append((source, destination))
    for filename in additional_files:
        source = staging / filename
        destination = published / filename
        validate_promotion_paths(source, destination)
        candidates.append((source, destination))

    changed = [
        (source, destination)
        for source, destination in candidates
        if content_changed(source, destination)
    ]
    if not changed:
        return []

    snapshots = {
        destination: destination.read_bytes() if destination.exists() else None
        for _, destination in changed
    }
    destinations = [destination for _, destination in changed]

    try:
        for source, destination in changed:
            promote_file(source, destination)
    except Exception as original_error:
        restoration_failures = _rollback_transaction(destinations, snapshots)
        if restoration_failures:
            details = "; ".join(restoration_failures)
            raise PublicationError(
                f"publication failed and rollback was incomplete: {details}"
            ) from original_error
        raise

    return destinations
