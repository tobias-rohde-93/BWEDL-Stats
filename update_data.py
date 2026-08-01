from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable, Sequence

from pipeline.files import write_json_pair
from pipeline.publish import publish_domains
from pipeline.report import DOMAIN_ORDER, write_report
from pipeline.validation import (
    Decision,
    ValidationResult,
    parse_javascript_assignment,
    validate_archive_payloads,
    validate_clubs,
    validate_json_js_pair,
    validate_leagues,
    validate_rankings,
)


SCRAPERS = (
    "league_scraper.py",
    "ranking_scraper.py",
    "club_scraper.py",
    "archive_scraper.py",
    "archive_tables_scraper.py",
)
PAIR_FILES = {
    "leagues": ("league_data.json", "league_data.js", "LEAGUE_DATA"),
    "rankings": ("ranking_data.json", "ranking_data.js", "RANKING_DATA"),
    "clubs": ("club_data.json", "club_data.js", "CLUB_DATA"),
}


def run_scraper(script: Path, output_dir: Path, artifacts_dir: Path) -> int:
    completed = subprocess.run(
        [
            sys.executable,
            "-u",
            str(script),
            "--output-dir",
            str(output_dir),
            "--artifacts-dir",
            str(artifacts_dir),
        ],
        check=False,
    )
    return completed.returncode


def _failed(domain: str, reason: str, season: str = "unknown") -> ValidationResult:
    return ValidationResult(domain, Decision.FAILED, season, (reason,))


def _strict_json(path: Path) -> Any:
    def reject(constant: str) -> Any:
        raise ValueError(f"non-standard JSON constant: {constant}")

    with path.open("r", encoding="utf-8", newline="") as source:
        return json.load(source, parse_constant=reject)


def _load_pair(directory: Path, domain: str) -> dict[str, Any]:
    json_name, js_name, global_name = PAIR_FILES[domain]
    payload = _strict_json(directory / json_name)
    if not isinstance(payload, dict):
        raise ValueError(f"{domain} JSON root must be an object")
    javascript = (directory / js_name).read_text(encoding="utf-8")
    valid, reason = validate_json_js_pair(payload, javascript, global_name)
    if not valid:
        raise ValueError(reason)
    return payload


def _load_status(root: Path) -> dict[str, Any]:
    payload = _strict_json(root / "data_status.json")
    if not isinstance(payload, dict):
        raise ValueError("data status root must be an object")
    javascript = (root / "data_status.js").read_text(encoding="utf-8")
    valid, reason = validate_json_js_pair(payload, javascript, "DATA_STATUS")
    if not valid:
        raise ValueError(reason)
    domains = payload.get("domains")
    if not isinstance(domains, dict) or set(domains) != set(DOMAIN_ORDER):
        raise ValueError("data status lacks canonical domains")
    _parse_aware_status_time(payload.get("generated_at"), "generated_at")
    for domain in DOMAIN_ORDER:
        record = domains[domain]
        if not isinstance(record, dict) or set(record) != {"season", "state", "updated_at"}:
            raise ValueError(f"invalid {domain} status record")
        if not isinstance(record["season"], str) or not record["season"].strip():
            raise ValueError(f"invalid {domain} status season")
        if record["state"] not in {"current", "retained"}:
            raise ValueError(f"invalid {domain} status state")
        _parse_aware_status_time(record["updated_at"], f"{domain} updated_at")
    return payload


def _parse_aware_status_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"invalid {label}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"invalid {label}") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"invalid {label}")
    return parsed


def _load_js(path: Path, global_name: str) -> Any:
    return parse_javascript_assignment(path.read_text(encoding="utf-8"), global_name)


def _validate_archives(staging: Path, root: Path) -> ValidationResult:
    return validate_archive_payloads(
        _load_js(staging / "archive_data.js", "ARCHIVE_DATA"),
        _load_js(root / "archive_data.js", "ARCHIVE_DATA"),
        _load_js(staging / "archive_tables.js", "ARCHIVE_TABLES"),
        _load_js(root / "archive_tables.js", "ARCHIVE_TABLES"),
    )


def _iso(timestamp: datetime) -> str:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("clock must return a timezone-aware datetime")
    return timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _changed_domains(
    staging: Path,
    root: Path,
    results: list[ValidationResult],
    previous_status: dict[str, Any],
) -> set[str]:
    filenames = {
        "leagues": ("league_data.json", "league_data.js"),
        "rankings": ("ranking_data.json", "ranking_data.js"),
        "clubs": ("club_data.json", "club_data.js"),
        "archives": ("archive_data.js", "archive_tables.js"),
    }
    return {
        result.domain
        for result in results
        if result.decision is Decision.PUBLISH
        and (
            any((staging / name).read_bytes() != (root / name).read_bytes() for name in filenames[result.domain])
            or (
                result.domain in {"leagues", "rankings"}
                and result.effective_season
                != previous_status["domains"][result.domain]["season"]
            )
        )
    }


def _build_status(
    previous: dict[str, Any],
    results: list[ValidationResult],
    timestamp: datetime,
    changed_domains: set[str],
) -> dict[str, Any]:
    now = _iso(timestamp)
    prior_domains = previous["domains"]
    domains: dict[str, Any] = {}
    for result in results:
        prior = prior_domains[result.domain]
        if result.decision is Decision.PUBLISH and result.domain in changed_domains:
            if result.domain in {"leagues", "rankings"}:
                season = result.effective_season
            else:
                season = prior["season"]
            domains[result.domain] = {"season": season, "state": "current", "updated_at": now}
        elif result.decision is Decision.RETAIN:
            domains[result.domain] = {
                "season": prior["season"],
                "state": "retained",
                "updated_at": prior["updated_at"],
            }
        else:
            domains[result.domain] = dict(prior)
    latest = max(item["updated_at"] for item in domains.values())
    return {"generated_at": latest, "domains": domains}


def _write_concise(path: Path, generated_at: str, results: list[ValidationResult]) -> None:
    payload = {
        "generated_at": generated_at,
        "success": all(result.decision in {Decision.PUBLISH, Decision.RETAIN} for result in results),
        "decisions": {result.domain: result.decision.value for result in results},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def _safe_fresh_staging(root: Path, staging: Path) -> None:
    root_resolved = root.resolve()
    staging_resolved = staging.resolve()
    if staging.is_symlink() or staging_resolved == root_resolved or staging_resolved in root_resolved.parents:
        raise ValueError("unsafe staging directory")
    if staging.exists():
        if not staging.is_dir() or any(staging.iterdir()):
            raise ValueError("staging directory must be empty and fresh")
    else:
        staging.mkdir(parents=True)


def run_update(
    root: Path,
    staging: Path,
    artifacts: Path,
    *,
    scraper_runner: Callable[[Path, Path, Path], int] = run_scraper,
    dry_run: bool = False,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> int:
    root, staging, artifacts = Path(root), Path(staging), Path(artifacts)
    started = clock()
    results: list[ValidationResult] = []
    published: list[Path] = []
    previous_status: dict[str, Any] | None = None
    scraper_codes: dict[str, int] = {}
    setup_error: Exception | None = None
    try:
        root.mkdir(parents=True, exist_ok=True)
        _safe_fresh_staging(root, staging)
        artifacts.mkdir(parents=True, exist_ok=True)
        previous_status = _load_status(root)
    except Exception as error:
        setup_error = error

    if setup_error is None:
        for script_name in SCRAPERS:
            try:
                scraper_codes[script_name] = scraper_runner(
                    root / script_name,
                    staging,
                    artifacts / Path(script_name).stem,
                )
            except Exception:
                scraper_codes[script_name] = -1

        previous_payloads: dict[str, dict[str, Any]] = {}
        candidate_payloads: dict[str, dict[str, Any]] = {}
        for domain in ("leagues", "rankings", "clubs"):
            script = {"leagues": "league_scraper.py", "rankings": "ranking_scraper.py", "clubs": "club_scraper.py"}[domain]
            season = previous_status["domains"][domain]["season"]
            if scraper_codes[script] != 0:
                results.append(_failed(domain, f"{script} exited with code {scraper_codes[script]}", season))
                continue
            try:
                previous_payloads[domain] = _load_pair(root, domain)
                candidate_payloads[domain] = _load_pair(staging, domain)
            except Exception as error:
                results.append(_failed(domain, f"could not load strict data pair: {error}", season))
                continue
            if domain == "leagues":
                try:
                    results.append(validate_leagues(candidate_payloads[domain], previous_payloads[domain]))
                except Exception as error:
                    results.append(_failed(domain, f"validation failed: {error}", season))
            elif domain == "clubs":
                try:
                    results.append(validate_clubs(candidate_payloads[domain], previous_payloads[domain]))
                except Exception as error:
                    results.append(_failed(domain, f"validation failed: {error}", season))

        league_result = next((item for item in results if item.domain == "leagues"), None)
        if "rankings" in candidate_payloads:
            prior_rankings = deepcopy(previous_payloads["rankings"])
            prior_rankings["season"] = previous_status["domains"]["rankings"]["season"]
            candidate_for_validation = deepcopy(candidate_payloads["rankings"])
            if league_result is None or league_result.decision not in {Decision.PUBLISH, Decision.RETAIN}:
                results.append(ValidationResult("rankings", Decision.BLOCKED, prior_rankings["season"], ("current league season is unavailable",)))
            else:
                explicit_season = candidate_for_validation.get("season")
                if not isinstance(explicit_season, str) or not explicit_season.strip():
                    candidate_for_validation["season"] = league_result.effective_season
                try:
                    ranking_result = validate_rankings(candidate_for_validation, prior_rankings)
                    if (
                        isinstance(explicit_season, str)
                        and explicit_season.strip()
                        and ranking_result.decision is Decision.PUBLISH
                        and ranking_result.effective_season != league_result.effective_season
                    ):
                        ranking_result = ValidationResult(
                            "rankings",
                            Decision.BLOCKED,
                            prior_rankings["season"],
                            ("Explicit ranking season does not match current league season",),
                            ranking_result.metrics,
                        )
                except Exception as error:
                    ranking_result = _failed(
                        "rankings", f"validation failed: {error}", prior_rankings["season"]
                    )
                results.append(ranking_result)

        archive_scripts = ("archive_scraper.py", "archive_tables_scraper.py")
        failed_archives = [name for name in archive_scripts if scraper_codes[name] != 0]
        if failed_archives:
            results.append(_failed("archives", "; ".join(f"{name} exited with code {scraper_codes[name]}" for name in failed_archives), previous_status["domains"]["archives"]["season"]))
        else:
            try:
                results.append(_validate_archives(staging, root))
            except Exception as error:
                results.append(_failed("archives", f"could not parse archive candidates: {error}", previous_status["domains"]["archives"]["season"]))
    else:
        results = [_failed(domain, f"update setup failed: {setup_error}") for domain in DOMAIN_ORDER]

    indexed = {result.domain: result for result in results}
    results = [indexed.get(domain, _failed(domain, "domain result was not produced")) for domain in DOMAIN_ORDER]
    ready = all(result.decision in {Decision.PUBLISH, Decision.RETAIN} for result in results)
    if ready and not dry_run and previous_status is not None:
        try:
            status = _build_status(
                previous_status,
                results,
                clock(),
                _changed_domains(staging, root, results, previous_status),
            )
            write_json_pair(staging, "data_status", "DATA_STATUS", status)
            published = publish_domains(staging, root, results, additional_files=("data_status.json", "data_status.js"))
        except Exception as error:
            results = [
                ValidationResult(
                    result.domain,
                    Decision.FAILED,
                    result.effective_season,
                    result.reasons + (f"prepublication failed: {error}",),
                    result.metrics,
                )
                for result in results
            ]
            published = []
            ready = False

    try:
        finished = clock()
        write_report(root / "update_report.json", results, published, started, finished)
        _write_concise(root / "update_status.json", _iso(finished), results)
    except Exception:
        print("error: could not write update report", file=sys.stderr)
        return 1
    return 0 if ready else 1


def _cleanup_generated_staging(root: Path, staging: Path) -> None:
    expected_parent = (root / ".staging").resolve()
    if not staging.exists() or staging.is_symlink():
        return
    resolved = staging.resolve()
    if (
        resolved.parent != expected_parent
        or not resolved.name.startswith("run-")
        or not resolved.is_dir()
    ):
        return
    shutil.rmtree(resolved)


def main(argv: Sequence[str] | None = None, *, root: Path | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run and transactionally publish BWEDL data updates")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--staging-dir", type=Path)
    parser.add_argument("--artifacts-dir", type=Path)
    arguments = parser.parse_args(argv)
    root = Path(root) if root is not None else Path(__file__).resolve().parent
    run_id = f"run-{uuid.uuid4()}"
    generated_staging = arguments.staging_dir is None
    staging = arguments.staging_dir or root / ".staging" / run_id
    artifacts = arguments.artifacts_dir or root / "artifacts" / run_id
    try:
        return run_update(root, staging, artifacts, dry_run=arguments.dry_run)
    finally:
        if generated_staging:
            _cleanup_generated_staging(root, staging)


if __name__ == "__main__":
    raise SystemExit(main())
