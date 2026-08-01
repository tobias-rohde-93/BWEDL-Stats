from __future__ import annotations

import os
from pathlib import Path

from pipeline.files import content_changed, promote_file
from pipeline.validation import Decision, ValidationResult


DOMAIN_FILES = {
    "leagues": ("league_data.json", "league_data.js"),
    "rankings": ("ranking_data.json", "ranking_data.js"),
    "clubs": ("club_data.json", "club_data.js"),
    "archives": ("archive_data.js", "archive_tables.js"),
}


class PublicationError(RuntimeError):
    """Raised when publication fails and the prior state cannot be restored."""


def _temporary_path(destination: Path, suffix: str) -> Path:
    return destination.with_suffix(destination.suffix + suffix)


def _restore_destination_original(destination: Path, previous: bytes | None) -> None:
    if previous is None:
        destination.unlink(missing_ok=True)
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    rollback_path = _temporary_path(destination, ".rollback")
    try:
        rollback_path.write_bytes(previous)
        os.replace(rollback_path, destination)
    finally:
        rollback_path.unlink(missing_ok=True)


_restore_destination = _restore_destination_original


def _remove_transaction_debris(destinations: list[Path]) -> list[str]:
    failures: list[str] = []
    for destination in destinations:
        for suffix in (".next", ".rollback"):
            temporary = _temporary_path(destination, suffix)
            try:
                temporary.unlink(missing_ok=True)
            except OSError as error:
                failures.append(f"{temporary.name}: {error}")
    return failures


def _rollback_transaction(
    destinations: list[Path], snapshots: dict[Path, bytes | None]
) -> list[str]:
    failures: list[str] = []
    for destination in destinations:
        try:
            _restore_destination(destination, snapshots[destination])
        except Exception as restore_error:
            failures.append(f"{destination.name}: {restore_error}")
    try:
        failures.extend(_remove_transaction_debris(destinations) or [])
    except Exception as cleanup_error:
        failures.append(f"cleanup: {cleanup_error}")
    return failures


def publish_domains(
    staging: Path,
    published: Path,
    results: list[ValidationResult],
) -> list[Path]:
    seen_domains: set[str] = set()
    for result in results:
        if result.domain not in DOMAIN_FILES:
            raise ValueError(f"unknown publication domain: {result.domain}")
        if result.domain in seen_domains:
            raise ValueError(f"duplicate publication domain: {result.domain}")
        seen_domains.add(result.domain)

    approved = [result for result in results if result.decision is Decision.PUBLISH]
    candidates: list[tuple[Path, Path]] = []
    for result in approved:
        for filename in DOMAIN_FILES[result.domain]:
            source = staging / filename
            if not source.is_file():
                raise FileNotFoundError(f"approved publication source is missing: {source}")
            candidates.append((source, published / filename))

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
        cleanup_failures = _remove_transaction_debris(destinations) or []
        if cleanup_failures:
            details = "; ".join(cleanup_failures)
            raise PublicationError(f"publication cleanup failed: {details}")
    except Exception as original_error:
        restoration_failures = _rollback_transaction(destinations, snapshots)
        if restoration_failures:
            details = "; ".join(restoration_failures)
            raise PublicationError(
                f"publication failed and rollback was incomplete: {details}"
            ) from original_error
        raise

    return destinations
