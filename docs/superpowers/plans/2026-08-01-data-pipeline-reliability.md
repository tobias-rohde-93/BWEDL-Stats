# Reliable Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent incomplete or malformed BWEDL scrape results from replacing valid public data while safely handling the 2025/26-to-2026/27 season transition.

**Architecture:** Each scraper writes candidate files into a run-specific staging directory. A central validator classifies each data domain as `publish`, `retain`, `blocked`, or `failed`; a publisher then atomically promotes only approved files. GitHub Actions runs fixtures, validation, publication, diagnostics, and two-strike issue notification before committing an explicit allowlist of generated files.

**Tech Stack:** Python 3.13, Playwright for Python, pytest, JSON, vanilla JavaScript, GitHub Actions, GitHub CLI

---

## Execution precondition

The current desktop checkout is behind `origin/main` and contains a user-owned modification to `.agent/rules/git-workflow.md`. Execute this plan in a fresh worktree based on the latest `origin/main`; do not pull, reset, stash, or overwrite the dirty checkout.

Use the design specification as the source of truth:

- `docs/superpowers/specs/2026-08-01-data-pipeline-reliability-design.md`

## Planned file map

### New production files

- `pipeline/__init__.py` — package marker.
- `pipeline/files.py` — staged paths, JSON/JavaScript pair writing, atomic promotion, content comparisons.
- `pipeline/validation.py` — validation decisions and all domain/cross-file rules.
- `pipeline/report.py` — update report model, JSON persistence, and GitHub step-summary rendering.
- `pipeline/diagnostics.py` — HTML, screenshot, and trace capture helpers.
- `pipeline/publish.py` — allowlisted promotion of approved candidate domains.
- `data_status.json` and `data_status.js` — public per-domain season/status metadata.

### New test files

- `tests/conftest.py` — temporary published/staging trees and reusable sample data.
- `tests/test_fixtures.py` — smoke-test that the sanitized fixtures are present and readable.
- `tests/fixtures/league_regular.html` — zero-value 2026/27 table with 18 selectable matchdays.
- `tests/fixtures/rankings_empty.html` — legitimate empty ranking overview.
- `tests/fixtures/rankings_partial.html` — only three ranking categories.
- `tests/fixtures/rankings_complete.html` — all four required ranking categories.
- `tests/test_files.py` — candidate writing and atomic promotion.
- `tests/test_validation.py` — domain and season-transition rules.
- `tests/test_publish.py` — retain/publish behavior and rollback safety.
- `tests/test_update_data.py` — orchestrator and report integration.

### Existing files to modify

- `requirements.txt` — add pytest.
- `league_scraper.py` — accept an output directory and stop writing public files directly.
- `ranking_scraper.py` — accept an output directory and preserve empty results only as candidates.
- `club_scraper.py` — accept an output directory.
- `archive_scraper.py` — accept an output directory.
- `archive_tables_scraper.py` — accept an output directory.
- `update_data.py` — own staging, validation, publication, exit codes, and reporting.
- `.github/workflows/update.yml` — pinned runtime, tests, artifacts, explicit commits, and issue automation.
- `index.html` — load public status metadata.
- `bundle_v31.js` — display independent league/ranking/club status.
- `.gitignore` — exclude staging and diagnostic output.
- `README.md` — document update safety and local verification commands.

## Task 1: Establish the test harness and representative fixtures

**Files:**
- Modify: `requirements.txt`
- Create: `tests/conftest.py`
- Create: `tests/test_fixtures.py`
- Create: `tests/fixtures/league_regular.html`
- Create: `tests/fixtures/rankings_empty.html`
- Create: `tests/fixtures/rankings_partial.html`
- Create: `tests/fixtures/rankings_complete.html`

- [ ] **Step 1: Add pytest to the dependency list**

Make `requirements.txt` contain:

```text
beautifulsoup4
playwright
pytest==8.4.2
```

- [ ] **Step 2: Create shared temporary-tree fixtures**

Create `tests/conftest.py`:

```python
import json
from pathlib import Path

import pytest


@pytest.fixture
def data_trees(tmp_path: Path) -> tuple[Path, Path]:
    published = tmp_path / "published"
    staging = tmp_path / "staging"
    published.mkdir()
    staging.mkdir()
    return published, staging


@pytest.fixture
def prior_rankings() -> dict:
    return {
        "season": "2025/26",
        "last_updated": "01.08.2026 12:00:00",
        "rankings": {
            "Bezirksliga": "<table><tr><td>Marco Merz</td></tr></table>",
            "A-Klasse": "<table><tr><td>Anna A</td></tr></table>",
            "B-Klasse": "<table><tr><td>Bernd B</td></tr></table>",
            "C-Klasse": "<table><tr><td>Clara C</td></tr></table>",
        },
        "players": [
            {"id": "1", "name": "Marco Merz", "league": "Bezirksliga"},
            {"id": "2", "name": "Anna A", "league": "A-Klasse"},
            {"id": "3", "name": "Bernd B", "league": "B-Klasse"},
            {"id": "4", "name": "Clara C", "league": "C-Klasse"},
        ],
    }


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
```

- [ ] **Step 3: Add minimal sanitized HTML fixtures**

Create `tests/fixtures/league_regular.html`:

```html
<main>
  <select name="wtWahl">
    <option value="1">1. Spieltag</option><option value="2">2. Spieltag</option>
    <option value="3">3. Spieltag</option><option value="4">4. Spieltag</option>
    <option value="5">5. Spieltag</option><option value="6">6. Spieltag</option>
    <option value="7">7. Spieltag</option><option value="8">8. Spieltag</option>
    <option value="9">9. Spieltag</option><option value="10">10. Spieltag</option>
    <option value="11">11. Spieltag</option><option value="12">12. Spieltag</option>
    <option value="13">13. Spieltag</option><option value="14">14. Spieltag</option>
    <option value="15">15. Spieltag</option><option value="16">16. Spieltag</option>
    <option value="17">17. Spieltag</option><option value="18">18. Spieltag</option>
  </select>
  <table>
    <thead><tr><th>Pl.</th><th>Mannschaft</th><th>Sp.</th><th>Punkte</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>DC Strikers</td><td>0</td><td>0:0</td></tr>
      <tr><td>2</td><td>Spielfrei</td><td>0</td><td>0:0</td></tr>
    </tbody>
  </table>
</main>
```

Create the ranking fixtures with these exact semantics:

```html
<!-- rankings_empty.html -->
<main><h2>Ranglisten</h2><table><tbody></tbody></table></main>
```

```html
<!-- rankings_partial.html -->
<main>
  <a href="/ranglisten/bezirksliga/">Bezirksliga 2026-2027</a>
  <a href="/ranglisten/a-klasse/">A-Klasse 2026-2027</a>
  <a href="/ranglisten/b-klasse/">B-Klasse 2026-2027</a>
</main>
```

Create `tests/test_fixtures.py`:

```python
from pathlib import Path


def test_representative_html_fixtures_are_readable():
    fixtures = Path("tests/fixtures")
    league = (fixtures / "league_regular.html").read_text(encoding="utf-8")
    complete = (fixtures / "rankings_complete.html").read_text(encoding="utf-8")
    assert league.count("Spieltag</option>") == 18
    assert "DC Strikers" in league
    assert all(name in complete for name in ("Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse"))
```

```html
<!-- rankings_complete.html -->
<main>
  <a href="/ranglisten/bezirksliga/">Bezirksliga 2026-2027</a>
  <a href="/ranglisten/a-klasse/">A-Klasse 2026-2027</a>
  <a href="/ranglisten/b-klasse/">B-Klasse 2026-2027</a>
  <a href="/ranglisten/c-klasse/">C-Klasse 2026-2027</a>
</main>
```

- [ ] **Step 4: Verify the harness**

Run:

```powershell
python -m pytest --collect-only -q
```

Expected: `1 passed`.

- [ ] **Step 5: Commit the test foundation**

```powershell
git add requirements.txt tests/conftest.py tests/test_fixtures.py tests/fixtures
git commit -m "test: add data pipeline fixtures"
```

## Task 2: Add safe staged file primitives

**Files:**
- Create: `pipeline/__init__.py`
- Create: `pipeline/files.py`
- Create: `tests/test_files.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing tests for paired output and atomic promotion**

Create `tests/test_files.py`:

```python
import json

from pipeline.files import promote_file, write_json_pair


def test_write_json_pair_creates_matching_json_and_javascript(data_trees):
    _, staging = data_trees
    payload = {"season": "2026/27", "players": [{"name": "Jörg"}]}

    write_json_pair(staging, "ranking_data", "RANKING_DATA", payload)

    parsed = json.loads((staging / "ranking_data.json").read_text(encoding="utf-8"))
    wrapper = (staging / "ranking_data.js").read_text(encoding="utf-8")
    assert parsed == payload
    assert wrapper == 'window.RANKING_DATA = {"season": "2026/27", "players": [{"name": "Jörg"}]};\n'


def test_promote_file_replaces_destination_without_partial_content(data_trees):
    published, staging = data_trees
    (published / "league_data.json").write_text('{"old": true}', encoding="utf-8")
    (staging / "league_data.json").write_text('{"new": true}', encoding="utf-8")

    promote_file(staging / "league_data.json", published / "league_data.json")

    assert (published / "league_data.json").read_text(encoding="utf-8") == '{"new": true}'
```

- [ ] **Step 2: Run the tests and confirm the missing module failure**

Run:

```powershell
python -m pytest tests/test_files.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline'`.

- [ ] **Step 3: Implement the file primitives**

Create an empty `pipeline/__init__.py` and create `pipeline/files.py`:

```python
import json
import os
from pathlib import Path
from typing import Any


def write_json_pair(
    output_dir: Path,
    stem: str,
    global_name: str,
    payload: dict[str, Any],
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    compact = json.dumps(payload, ensure_ascii=False, separators=(",", ": "))
    json_path = output_dir / f"{stem}.json"
    js_path = output_dir / f"{stem}.js"
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    js_path.write_text(
        f"window.{global_name} = {compact};\n",
        encoding="utf-8",
    )
    return json_path, js_path


def promote_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".next")
    temporary.write_bytes(source.read_bytes())
    os.replace(temporary, destination)


def content_changed(source: Path, destination: Path) -> bool:
    return not destination.exists() or source.read_bytes() != destination.read_bytes()
```

- [ ] **Step 4: Exclude run artifacts**

Append to `.gitignore`:

```text
.staging/
artifacts/
```

- [ ] **Step 5: Run tests**

Run:

```powershell
python -m pytest tests/test_files.py -q
```

Expected: `2 passed`.

- [ ] **Step 6: Commit**

```powershell
git add .gitignore pipeline/__init__.py pipeline/files.py tests/test_files.py
git commit -m "feat: add staged data file primitives"
```

## Task 3: Make every scraper write candidates instead of public files

**Files:**
- Modify: `league_scraper.py`
- Modify: `ranking_scraper.py`
- Modify: `club_scraper.py`
- Modify: `archive_scraper.py`
- Modify: `archive_tables_scraper.py`
- Create: `tests/test_scraper_outputs.py`

- [ ] **Step 1: Write a failing contract test for scraper arguments**

Create `tests/test_scraper_outputs.py`:

```python
import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    "script",
    [
        "league_scraper.py",
        "ranking_scraper.py",
        "club_scraper.py",
        "archive_scraper.py",
        "archive_tables_scraper.py",
    ],
)
def test_scraper_exposes_output_dir_argument(script):
    result = subprocess.run(
        [sys.executable, script, "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--output-dir" in result.stdout
```

- [ ] **Step 2: Run the contract test and verify failure**

Run:

```powershell
python -m pytest tests/test_scraper_outputs.py -q
```

Expected: all five cases FAIL because the scripts do not expose `--output-dir`.

- [ ] **Step 3: Add the common CLI contract to each scraper**

In each scraper, add:

```python
import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("."),
        help="Directory for candidate output files",
    )
    parser.add_argument(
        "--artifacts-dir",
        type=Path,
        default=Path("artifacts"),
        help="Directory for failure diagnostics",
    )
    return parser.parse_args()
```

Call `args = parse_args()` in `main()` and pass `args.output_dir` into the scraper's save function. Preserve `Path(".")` as the default so manual legacy invocation still works during rollout.

- [ ] **Step 4: Replace direct JSON/JS writes**

For league, ranking, and club data, use `write_json_pair()` from `pipeline.files`. Example for rankings:

```python
from pipeline.files import write_json_pair


def save_data(data: dict, output_dir: Path) -> None:
    data["last_updated"] = datetime.datetime.now().strftime("%d.%m.%Y %H:%M:%S")
    write_json_pair(output_dir, "ranking_data", "RANKING_DATA", data)
```

For JS-only archive outputs, write complete archive candidates to `output_dir / "archive_data.js"` and `output_dir / "archive_tables.js"`; do not read or merge public files from inside the scraper. The central validator compares candidate season keys with the published season keys. If any published season is absent, classify the archive domain as `blocked` and leave both published archive files untouched; never silently synthesize a mixed archive from stale and newly scraped fragments.

- [ ] **Step 5: Run the scraper contract tests**

Run:

```powershell
python -m pytest tests/test_scraper_outputs.py -q
python -m py_compile league_scraper.py ranking_scraper.py club_scraper.py archive_scraper.py archive_tables_scraper.py
```

Expected: `5 passed`; compilation exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add league_scraper.py ranking_scraper.py club_scraper.py archive_scraper.py archive_tables_scraper.py tests/test_scraper_outputs.py
git commit -m "refactor: write scraper results to staging"
```

## Task 4: Implement validation decisions and the ranking season gate

**Files:**
- Create: `pipeline/validation.py`
- Create: `tests/test_validation.py`

- [ ] **Step 1: Write failing ranking-transition tests**

Create `tests/test_validation.py`:

```python
from pipeline.validation import Decision, validate_rankings


def player(player_id: str, league: str) -> dict:
    return {"id": player_id, "name": f"Player {player_id}", "league": league}


def test_empty_new_rankings_retain_prior_season(prior_rankings):
    candidate = {"season": "2026/27", "rankings": {}, "players": []}
    result = validate_rankings(candidate, prior_rankings)
    assert result.decision is Decision.RETAIN
    assert result.effective_season == "2025/26"


def test_partial_new_rankings_retain_prior_season(prior_rankings):
    candidate = {
        "season": "2026/27",
        "rankings": {"Bezirksliga": "x", "A-Klasse": "x", "B-Klasse": "x"},
        "players": [player("1", "Bezirksliga"), player("2", "A-Klasse"), player("3", "B-Klasse")],
    }
    result = validate_rankings(candidate, prior_rankings)
    assert result.decision is Decision.RETAIN


def test_all_four_categories_activate_new_season(prior_rankings):
    categories = ["Bezirksliga", "A-Klasse", "B-Klasse", "C-Klasse"]
    candidate = {
        "season": "2026/27",
        "rankings": {category: "<table></table>" for category in categories},
        "players": [player(str(index), category) for index, category in enumerate(categories, 1)],
    }
    result = validate_rankings(candidate, prior_rankings)
    assert result.decision is Decision.PUBLISH
    assert result.effective_season == "2026/27"
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
python -m pytest tests/test_validation.py -q
```

Expected: FAIL because `pipeline.validation` does not exist.

- [ ] **Step 3: Implement the validation model and ranking gate**

Create `pipeline/validation.py`:

```python
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class Decision(StrEnum):
    PUBLISH = "publish"
    RETAIN = "retain"
    BLOCKED = "blocked"
    FAILED = "failed"


@dataclass(frozen=True)
class ValidationResult:
    domain: str
    decision: Decision
    effective_season: str
    reasons: list[str] = field(default_factory=list)
    metrics: dict[str, int] = field(default_factory=dict)


REQUIRED_RANKING_CATEGORIES = (
    "Bezirksliga",
    "A-Klasse",
    "B-Klasse",
    "C-Klasse",
)


def validate_rankings(candidate: dict[str, Any], previous: dict[str, Any]) -> ValidationResult:
    players = candidate.get("players") or []
    category_counts = {
        category: sum(1 for item in players if item.get("league") == category)
        for category in REQUIRED_RANKING_CATEGORIES
    }
    invalid_players = [
        item
        for item in players
        if not item.get("id") or not item.get("name") or not item.get("league")
    ]
    if invalid_players:
        return ValidationResult(
            domain="rankings",
            decision=Decision.BLOCKED,
            effective_season=previous.get("season", "unknown"),
            reasons=[f"{len(invalid_players)} players lack id, name, or league"],
            metrics=category_counts,
        )
    missing = [name for name, count in category_counts.items() if count < 1]
    if missing:
        return ValidationResult(
            domain="rankings",
            decision=Decision.RETAIN,
            effective_season=previous.get("season", "unknown"),
            reasons=["new season is missing: " + ", ".join(missing)],
            metrics=category_counts,
        )
    return ValidationResult(
        domain="rankings",
        decision=Decision.PUBLISH,
        effective_season=candidate.get("season", "unknown"),
        metrics=category_counts,
    )
```

- [ ] **Step 4: Run the ranking tests**

Run:

```powershell
python -m pytest tests/test_validation.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add pipeline/validation.py tests/test_validation.py
git commit -m "feat: validate ranking season activation"
```

## Task 5: Add league, club, archive, and cross-file validation

**Files:**
- Modify: `pipeline/validation.py`
- Modify: `tests/test_validation.py`

- [ ] **Step 1: Add failing domain-validation tests**

Add tests that assert:

```python
from pipeline.validation import validate_archives, validate_clubs, validate_leagues


def test_regular_leagues_require_13_leagues_and_18_matchdays():
    candidate = {
        "season": "2026/27",
        "leagues": {
            "Bezirksliga 2026-2027": {
                "table": "<table><tr><td>DC Strikers</td></tr></table>",
                "match_days": {f"{number}. Spieltag": "---" for number in range(1, 19)},
            }
        },
    }
    result = validate_leagues(candidate, previous={"leagues": {}})
    assert result.decision is Decision.BLOCKED
    assert "13" in result.reasons[0]


def test_empty_clubs_cannot_replace_published_clubs():
    result = validate_clubs({"clubs": []}, {"clubs": [{"number": "1", "name": "Club"}]})
    assert result.decision is Decision.BLOCKED


def test_archive_cannot_drop_existing_seasons():
    result = validate_archives(
        candidate_seasons={"2025/26"},
        previous_seasons={"2024/25", "2025/26"},
    )
    assert result.decision is Decision.BLOCKED
```

- [ ] **Step 2: Run and confirm failure**

Run:

```powershell
python -m pytest tests/test_validation.py -q
```

Expected: FAIL because the three domain validators are undefined.

- [ ] **Step 3: Implement explicit thresholds**

Add to `pipeline/validation.py`:

```python
MIN_REGULAR_LEAGUES = 13
EXPECTED_MATCHDAYS = 18
MIN_CLUB_RATIO = 0.80


def validate_leagues(candidate: dict, previous: dict) -> ValidationResult:
    leagues = {
        name: value
        for name, value in (candidate.get("leagues") or {}).items()
        if "ligapokal" not in name.lower()
    }
    if len(leagues) < MIN_REGULAR_LEAGUES:
        return ValidationResult("leagues", Decision.BLOCKED, candidate.get("season", "unknown"), [f"expected at least {MIN_REGULAR_LEAGUES} regular leagues, got {len(leagues)}"])
    invalid = [
        name
        for name, value in leagues.items()
        if not value.get("table") or len(value.get("match_days") or {}) != EXPECTED_MATCHDAYS
    ]
    if invalid:
        return ValidationResult("leagues", Decision.BLOCKED, candidate.get("season", "unknown"), ["invalid league structure: " + ", ".join(invalid)])
    return ValidationResult("leagues", Decision.PUBLISH, candidate.get("season", "unknown"), metrics={"leagues": len(leagues)})


def validate_clubs(candidate: dict, previous: dict) -> ValidationResult:
    clubs = candidate.get("clubs") or []
    previous_clubs = previous.get("clubs") or []
    numbers = [str(club.get("number", "")) for club in clubs]
    if not clubs:
        return ValidationResult("clubs", Decision.BLOCKED, "current", ["candidate contains no clubs"])
    if len(numbers) != len(set(numbers)) or "" in numbers:
        return ValidationResult("clubs", Decision.BLOCKED, "current", ["club numbers are missing or duplicated"])
    if previous_clubs and len(clubs) < len(previous_clubs) * MIN_CLUB_RATIO:
        return ValidationResult("clubs", Decision.BLOCKED, "current", ["club count dropped by more than 20 percent"])
    return ValidationResult("clubs", Decision.PUBLISH, "current", metrics={"clubs": len(clubs)})


def validate_archives(candidate_seasons: set[str], previous_seasons: set[str]) -> ValidationResult:
    missing = sorted(previous_seasons - candidate_seasons)
    if missing:
        return ValidationResult("archives", Decision.BLOCKED, "historical", ["missing historical seasons: " + ", ".join(missing)])
    return ValidationResult("archives", Decision.PUBLISH, "historical", metrics={"seasons": len(candidate_seasons)})
```

- [ ] **Step 4: Add JSON/JavaScript equivalence validation**

Add a function that removes the exact `window.NAME = ` prefix and trailing semicolon, parses the remaining JSON, and compares it with the `.json` payload. Add one passing and one mismatching test for German characters.

- [ ] **Step 5: Run all validation tests**

Run:

```powershell
python -m pytest tests/test_validation.py -q
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add pipeline/validation.py tests/test_validation.py
git commit -m "feat: validate all published data domains"
```

## Task 6: Implement reports, publishing, and rollback safety

**Files:**
- Create: `pipeline/report.py`
- Create: `pipeline/publish.py`
- Create: `tests/test_publish.py`

- [ ] **Step 1: Write failing retain and publish tests**

Create `tests/test_publish.py`:

```python
import json

from pipeline.publish import publish_domains
from pipeline.validation import Decision, ValidationResult


def test_retained_rankings_leave_previous_files_untouched(data_trees):
    published, staging = data_trees
    old = {"season": "2025/26", "players": [{"id": "1"}]}
    new = {"season": "2026/27", "players": []}
    (published / "ranking_data.json").write_text(json.dumps(old), encoding="utf-8")
    (staging / "ranking_data.json").write_text(json.dumps(new), encoding="utf-8")
    result = ValidationResult("rankings", Decision.RETAIN, "2025/26")

    published_files = publish_domains(staging, published, [result])

    assert published_files == []
    assert json.loads((published / "ranking_data.json").read_text(encoding="utf-8")) == old


def test_publish_promotes_json_and_javascript_together(data_trees):
    published, staging = data_trees
    (staging / "ranking_data.json").write_text('{"season":"2026/27"}', encoding="utf-8")
    (staging / "ranking_data.js").write_text('window.RANKING_DATA = {"season":"2026/27"};', encoding="utf-8")
    result = ValidationResult("rankings", Decision.PUBLISH, "2026/27")

    published_files = publish_domains(staging, published, [result])

    assert sorted(path.name for path in published_files) == ["ranking_data.js", "ranking_data.json"]


def test_publish_rolls_back_entire_domain_when_second_file_fails(data_trees, monkeypatch):
    published, staging = data_trees
    old_json = b'{"season":"2025/26"}'
    old_js = b'window.RANKING_DATA = {"season":"2025/26"};'
    (published / "ranking_data.json").write_bytes(old_json)
    (published / "ranking_data.js").write_bytes(old_js)
    (staging / "ranking_data.json").write_bytes(b'{"season":"2026/27"}')
    (staging / "ranking_data.js").write_bytes(b'window.RANKING_DATA = {"season":"2026/27"};')

    from pipeline import publish

    real_promote = publish.promote_file
    calls = 0

    def fail_second(source, destination):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated promotion failure")
        real_promote(source, destination)

    monkeypatch.setattr(publish, "promote_file", fail_second)
    result = ValidationResult("rankings", Decision.PUBLISH, "2026/27")

    with pytest.raises(OSError, match="simulated"):
        publish_domains(staging, published, [result])

    assert (published / "ranking_data.json").read_bytes() == old_json
    assert (published / "ranking_data.js").read_bytes() == old_js
```

Also add `import pytest` at the top of `tests/test_publish.py`.

- [ ] **Step 2: Confirm failure**

Run:

```powershell
python -m pytest tests/test_publish.py -q
```

Expected: FAIL because `pipeline.publish` does not exist.

- [ ] **Step 3: Implement an explicit domain allowlist**

Create `pipeline/publish.py` with this mapping:

```python
from pathlib import Path

from pipeline.files import promote_file
from pipeline.validation import Decision, ValidationResult


DOMAIN_FILES = {
    "leagues": ("league_data.json", "league_data.js"),
    "rankings": ("ranking_data.json", "ranking_data.js"),
    "clubs": ("club_data.json", "club_data.js"),
    "archives": ("archive_data.js", "archive_tables.js"),
}


def publish_domains(
    staging: Path,
    published: Path,
    results: list[ValidationResult],
) -> list[Path]:
    promoted: list[Path] = []
    for result in results:
        if result.decision is not Decision.PUBLISH:
            continue
        destinations = [published / name for name in DOMAIN_FILES[result.domain]]
        sources = [staging / name for name in DOMAIN_FILES[result.domain]]
        missing = [path.name for path in sources if not path.exists()]
        if missing:
            raise FileNotFoundError("approved candidate is missing " + ", ".join(missing))
        previous = {
            path: path.read_bytes() if path.exists() else None
            for path in destinations
        }
        try:
            for source, destination in zip(sources, destinations, strict=True):
                promote_file(source, destination)
                promoted.append(destination)
        except Exception:
            for destination, content in previous.items():
                if content is None:
                    destination.unlink(missing_ok=True)
                else:
                    rollback = staging / f"rollback-{destination.name}"
                    rollback.write_bytes(content)
                    promote_file(rollback, destination)
            promoted = [path for path in promoted if path not in destinations]
            raise
    return promoted
```

- [ ] **Step 4: Implement the report writer**

Create `pipeline/report.py` with `write_report()` and `render_step_summary()`. The module must also support the workflow call `python -m pipeline.report --summary update_report.json`:

```python
import argparse
import json
from datetime import datetime
from pathlib import Path

from pipeline.validation import ValidationResult


def write_report(
    path: Path,
    results: list[ValidationResult],
    published_files: list[Path],
    started_at: datetime,
    finished_at: datetime,
) -> dict:
    report = {
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "success": all(result.decision.value in {"publish", "retain"} for result in results),
        "domains": [
            {
                "domain": result.domain,
                "decision": result.decision.value,
                "effective_season": result.effective_season,
                "reasons": result.reasons,
                "metrics": result.metrics,
            }
            for result in results
        ],
        "published_files": [item.name for item in published_files],
    }
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def render_step_summary(report: dict) -> str:
    lines = [
        "# BWEDL data update",
        "",
        "| Domain | Decision | Effective season | Reasons |",
        "|---|---|---|---|",
    ]
    for item in report.get("domains", []):
        reasons = "; ".join(item.get("reasons") or []) or "-"
        lines.append(
            f"| {item['domain']} | {item['decision']} | "
            f"{item['effective_season']} | {reasons} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.summary.read_text(encoding="utf-8"))
    print(render_step_summary(report), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run publish tests**

Run:

```powershell
python -m pytest tests/test_publish.py -q
```

Expected: `3 passed`.

- [ ] **Step 6: Commit**

```powershell
git add pipeline/report.py pipeline/publish.py tests/test_publish.py
git commit -m "feat: publish validated data atomically"
```

## Task 7: Replace the update orchestrator with transactional execution

**Files:**
- Modify: `update_data.py`
- Create: `tests/test_update_data.py`
- Create: `data_status.json`
- Create: `data_status.js`

- [ ] **Step 1: Write a failing orchestrator test**

Create `tests/test_update_data.py` using monkeypatch to replace scraper subprocess execution with fixture writers. Assert that an empty ranking candidate produces a successful overall run with ranking decision `retain`, league decision `publish`, unchanged published ranking files, and updated league files.

The test must call a new function with this signature:

```python
run_update(root: Path, staging: Path, artifacts: Path) -> int
```

Expected return codes:

- `0`: all domains are `publish` or `retain`;
- `1`: at least one domain is `blocked` or `failed`.

- [ ] **Step 2: Run and confirm failure**

Run:

```powershell
python -m pytest tests/test_update_data.py -q
```

Expected: FAIL because `run_update` is undefined.

- [ ] **Step 3: Refactor `update_data.py`**

Implement:

```python
SCRAPERS = (
    "league_scraper.py",
    "ranking_scraper.py",
    "club_scraper.py",
    "archive_scraper.py",
    "archive_tables_scraper.py",
)


def run_scraper(script: str, staging: Path, artifacts: Path) -> int:
    completed = subprocess.run(
        [
            sys.executable,
            "-u",
            script,
            "--output-dir",
            str(staging),
            "--artifacts-dir",
            str(artifacts / Path(script).stem),
        ],
        check=False,
    )
    return completed.returncode
```

`run_update()` must:

1. clear only the resolved run-specific staging directory;
2. execute all candidate scrapers;
3. convert non-zero scraper exits to `failed` results;
4. load previous and candidate data;
5. validate every domain;
6. publish only `publish` domains;
7. preserve `retain` domains;
8. write `update_report.json` and `update_status.json`;
9. write `data_status.json` and matching `data_status.js`;
10. return `1` for `blocked` or `failed` results.

- [ ] **Step 4: Define public status metadata**

Use this shape:

```json
{
  "generated_at": "2026-08-01T13:15:07Z",
  "domains": {
    "leagues": {"season": "2026/27", "state": "current", "updated_at": "2026-08-01T13:14:40Z"},
    "rankings": {"season": "2025/26", "state": "retained", "updated_at": "2026-04-20T08:06:56Z"},
    "clubs": {"season": "current", "state": "current", "updated_at": "2026-08-01T13:15:07Z"}
  }
}
```

- [ ] **Step 5: Run orchestrator and regression tests**

Run:

```powershell
python -m pytest tests/test_update_data.py tests/test_publish.py tests/test_validation.py -q
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add update_data.py tests/test_update_data.py data_status.json data_status.js
git commit -m "feat: orchestrate transactional data updates"
```

## Task 8: Capture Playwright diagnostics on scraper failure

**Files:**
- Create: `pipeline/diagnostics.py`
- Modify: `league_scraper.py`
- Modify: `ranking_scraper.py`
- Modify: `club_scraper.py`
- Modify: `archive_scraper.py`
- Modify: `archive_tables_scraper.py`
- Create: `tests/test_diagnostics.py`

- [ ] **Step 1: Write a failing artifact-path test**

Create `tests/test_diagnostics.py`:

```python
from pipeline.diagnostics import artifact_paths


def test_artifact_paths_create_directory_and_sanitize_slug(tmp_path):
    directory = tmp_path / "artifacts"
    paths = artifact_paths(directory, "ranking overview/../../secret")
    assert directory.is_dir()
    assert paths["html"].name == "ranking-overview-secret.html"
    assert paths["screenshot"].name == "ranking-overview-secret.png"
    assert paths["trace"].name == "ranking-overview-secret-trace.zip"
    assert all(path.parent == directory for path in paths.values())
```

- [ ] **Step 2: Implement diagnostics helpers**

Create `pipeline/diagnostics.py`:

```python
import re
from pathlib import Path


def artifact_paths(directory: Path, slug: str) -> dict[str, Path]:
    safe_slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", slug).strip("-") or "page"
    directory.mkdir(parents=True, exist_ok=True)
    return {
        "html": directory / f"{safe_slug}.html",
        "screenshot": directory / f"{safe_slug}.png",
        "trace": directory / f"{safe_slug}-trace.zip",
    }


def capture_page(page, directory: Path, slug: str) -> dict[str, Path]:
    paths = artifact_paths(directory, slug)
    paths["html"].write_text(page.content(), encoding="utf-8")
    page.screenshot(path=str(paths["screenshot"]), full_page=True)
    return paths
```

- [ ] **Step 3: Add tracing and structured failures to each scraper**

For each browser context:

```python
context.tracing.start(screenshots=True, snapshots=True, sources=True)
```

On exception, call `capture_page()`, stop tracing to the returned trace path, print one structured line beginning `SCRAPER_FAILURE ` followed by JSON, and exit non-zero. On success, stop tracing without writing a file.

- [ ] **Step 4: Run diagnostics and compilation tests**

Run:

```powershell
python -m pytest tests/test_diagnostics.py tests/test_scraper_outputs.py -q
python -m py_compile pipeline/diagnostics.py league_scraper.py ranking_scraper.py club_scraper.py archive_scraper.py archive_tables_scraper.py
```

Expected: tests PASS and compilation exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add pipeline/diagnostics.py tests/test_diagnostics.py league_scraper.py ranking_scraper.py club_scraper.py archive_scraper.py archive_tables_scraper.py
git commit -m "feat: capture scraper failure diagnostics"
```

## Task 9: Harden GitHub Actions and add two-strike issue notification

**Files:**
- Modify: `.github/workflows/update.yml`

- [ ] **Step 1: Add workflow validation tests before publication**

Replace the workflow with maintained official action majors and this ordered structure:

```yaml
name: Update Data

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  actions: read

jobs:
  update-data:
    timeout-minutes: 30
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 2
      - uses: actions/setup-python@v6
        with:
          python-version: "3.13"
          cache: pip
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          python -m playwright install --with-deps chromium
      - name: Run offline tests
        run: python -m pytest -q
      - name: Run transactional update
        run: python update_data.py
      - name: Write job summary
        if: always()
        run: python -m pipeline.report --summary update_report.json >> "$GITHUB_STEP_SUMMARY"
      - name: Upload diagnostics
        if: failure()
        uses: actions/upload-artifact@v5
        with:
          name: scraper-diagnostics-${{ github.run_id }}
          path: |
            artifacts/
            update_report.json
          if-no-files-found: warn
          retention-days: 14
      - name: Commit approved data
        if: success()
        run: |
          git config user.name "GitHub Actions Bot"
          git config user.email "actions@users.noreply.github.com"
          git add league_data.json league_data.js ranking_data.json ranking_data.js club_data.json club_data.js archive_data.js archive_tables.js data_status.json data_status.js
          if git diff --staged --quiet; then
            echo "No approved data changes"
          else
            git commit -m "Automated Data Update"
            git push
          fi
```

- [ ] **Step 2: Add two-strike failure handling**

The current run is still reported as `in_progress` while its failure handler executes. Therefore, treat the current failed job as strike two and inspect the immediately preceding completed scheduled run. Add this step after artifact upload:

```yaml
      - name: Open or update issue after two consecutive failures
        if: failure() && github.event_name == 'schedule'
        env:
          GH_TOKEN: ${{ github.token }}
          REPOSITORY: ${{ github.repository }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        shell: bash
        run: |
          previous_conclusion="$(gh run list \
            --repo "$REPOSITORY" \
            --workflow "Update Data" \
            --event schedule \
            --status completed \
            --limit 1 \
            --json conclusion \
            --jq '.[0].conclusion // ""')"
          if [ "$previous_conclusion" != "failure" ]; then
            echo "Previous completed scheduled run did not fail; no issue yet."
            exit 0
          fi
          gh label create automated-scraper-failure \
            --repo "$REPOSITORY" \
            --color D73A4A \
            --description "Two or more consecutive scheduled scraper failures" \
            --force
          issue_number="$(gh issue list \
            --repo "$REPOSITORY" \
            --label automated-scraper-failure \
            --state open \
            --limit 1 \
            --json number \
            --jq '.[0].number // ""')"
          if [ -z "$issue_number" ]; then
            gh issue create \
              --repo "$REPOSITORY" \
              --label automated-scraper-failure \
              --title "Automatisches BWEDL-Datenupdate wiederholt fehlgeschlagen" \
              --body "Zwei aufeinanderfolgende geplante Datenupdates sind fehlgeschlagen. Aktueller Lauf: $RUN_URL. Diagnose-Artefakte sind am Lauf hinterlegt."
          else
            gh issue comment "$issue_number" \
              --repo "$REPOSITORY" \
              --body "Erneuter geplanter Fehlschlag: $RUN_URL"
          fi
```

- [ ] **Step 3: Add recovery handling**

Add this step after the commit step so a successful scheduled recovery closes the existing incident:

```yaml
      - name: Close scraper issue after recovery
        if: success() && github.event_name == 'schedule'
        env:
          GH_TOKEN: ${{ github.token }}
          REPOSITORY: ${{ github.repository }}
          RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        shell: bash
        run: |
          issue_number="$(gh issue list \
            --repo "$REPOSITORY" \
            --label automated-scraper-failure \
            --state open \
            --limit 1 \
            --json number \
            --jq '.[0].number // ""')"
          if [ -n "$issue_number" ]; then
            gh issue comment "$issue_number" \
              --repo "$REPOSITORY" \
              --body "Das geplante Datenupdate läuft wieder erfolgreich: $RUN_URL"
            gh issue close "$issue_number" \
              --repo "$REPOSITORY" \
              --reason completed
          fi
```

- [ ] **Step 4: Validate workflow syntax and run tests**

Run:

```powershell
python -m pytest -q
git diff --check -- .github/workflows/update.yml
```

Expected: tests PASS and `git diff --check` exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/update.yml
git commit -m "ci: guard and diagnose scheduled data updates"
```

## Task 10: Show independent data freshness in the frontend

**Files:**
- Modify: `index.html`
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Create: `tests/test_public_status.py`

- [ ] **Step 1: Write a failing static contract test**

Create `tests/test_public_status.py`:

```python
from pathlib import Path


def test_frontend_loads_and_renders_domain_status():
    html = Path("index.html").read_text(encoding="utf-8")
    bundle = Path("bundle_v31.js").read_text(encoding="utf-8")
    assert 'src="data_status.js' in html
    assert "window.DATA_STATUS" in bundle
    assert "Vorjahresstand" in bundle
```

- [ ] **Step 2: Run and verify failure**

Run:

```powershell
python -m pytest tests/test_public_status.py -q
```

Expected: FAIL because status metadata is not loaded or rendered.

- [ ] **Step 3: Load status before the application bundle**

Add this script tag before `bundle_v31.js` in `index.html`:

```html
<script src="data_status.js?v=1"></script>
```

Add both `data_status.json` and `data_status.js` to the service-worker data-file cache and network-first detection.

- [ ] **Step 4: Render per-domain status**

In `bundle_v31.js`, read:

```javascript
const dataStatus = window.DATA_STATUS || { domains: {} };
```

Replace the single ambiguous timestamp with three compact status rows. For a retained ranking domain, render exactly:

```javascript
const rankingLabel = rankingStatus.state === 'retained'
    ? `Rangliste: Vorjahresstand ${rankingStatus.season}`
    : `Rangliste: ${rankingStatus.season} · ${rankingStatus.updated_at}`;
```

Keep the existing local update button behavior unchanged.

- [ ] **Step 5: Run static and syntax checks**

Run:

```powershell
python -m pytest tests/test_public_status.py -q
node --check bundle_v31.js
node --check sw_v31.js
```

Expected: test passes and both syntax checks exit `0`.

- [ ] **Step 6: Commit**

```powershell
git add index.html bundle_v31.js style.css sw_v31.js tests/test_public_status.py
git commit -m "feat: display per-domain data freshness"
```

## Task 11: Full verification, documentation, and guarded rollout

**Files:**
- Modify: `README.md`
- Modify: `USER_GUIDE.md`

- [ ] **Step 1: Document operational behavior**

Document:

- local update command;
- dry-run and test commands;
- staging and artifact locations;
- the four validation decisions;
- ranking season activation rule;
- how to inspect and recover from an automated scraper issue;
- explicit statement that retained ranking data is labeled as prior-season data.

- [ ] **Step 2: Run the complete automated verification**

Run:

```powershell
python -m pytest -q
python -m py_compile update_data.py pipeline/files.py pipeline/validation.py pipeline/report.py pipeline/diagnostics.py pipeline/publish.py league_scraper.py ranking_scraper.py club_scraper.py archive_scraper.py archive_tables_scraper.py
node --check bundle_v31.js
node --check sw_v31.js
git diff --check
```

Expected: all tests pass; Python and JavaScript syntax checks exit `0`; `git diff --check` produces no errors.

- [ ] **Step 3: Run a local candidate update without publication**

Expose and run:

```powershell
python update_data.py --dry-run
```

Expected for the current season-transition state:

- leagues: `publish`, season `2026/27`;
- rankings: `retain`, season `2025/26`;
- clubs: `publish`;
- public ranking files unchanged;
- `update_report.json` records the missing new-season ranking categories.

- [ ] **Step 4: Verify the public UI locally**

Start `server.py` and use Playwright CLI to verify desktop and 390-pixel mobile layouts. Check:

- league status shows 2026/27;
- ranking status shows `Vorjahresstand 2025/26`;
- player search still contains the retained ranking players;
- H2H and Match Preview remain accessible;
- no application errors appear in the browser console.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md USER_GUIDE.md
git commit -m "docs: explain guarded data updates"
```

- [ ] **Step 6: Push to a feature branch and run manually**

Push the implementation branch and manually dispatch `Update Data`. Do not merge until:

- the workflow is green;
- the report shows rankings retained rather than emptied;
- diagnostics are absent for a normal retained run;
- the Pages preview or branch-hosted local check displays the correct season labels.

- [ ] **Step 7: Observe scheduled behavior before cleanup**

After merge, observe at least two scheduled six-hour runs. Confirm there are no timestamp-only commits, no duplicate failure issues, and no loss of retained ranking data. Keep legacy compatibility paths until those observations pass.
