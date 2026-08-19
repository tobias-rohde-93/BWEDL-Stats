# Team Calendar Subscription and Unified Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one automatically updated GitHub Pages calendar feed for every profile-selectable league team, expose the selected team's subscription in Dashboard and Profile, remove one-off ICS downloads, and show club favorites in the global favorites list.

**Architecture:** A new pure Python calendar module parses the already validated regular-league schedule, resolves stable team identities and home-club addresses, and renders deterministic stateful RFC-5545 feeds. `update_data.py` stages the calendar index, state, and owned `calendars/` tree inside the existing all-or-nothing publication transaction; the static browser app resolves the stored profile team against that index and presents HTTPS and `webcal` subscription actions.

**Tech Stack:** Python 3.13, `zoneinfo`, Vanilla JavaScript, HTML5 `<dialog>`, CSS, Node `assert`, pytest, GitHub Actions, GitHub Pages, static PWA/service worker.

---

## File responsibility map

- Create `pipeline/calendar_feeds.py`: regular-league parsing, stable club/team/event identity, state transitions, ICS escaping/folding/rendering, output validation, and a deterministic CLI used for initial artifacts.
- Create `tests/test_calendar_feeds.py`: unit, state-transition, security, current-data audit, and deterministic artifact tests for the calendar module.
- Modify `pipeline/publish.py`: safely promote and roll back one explicitly owned dynamic directory in the same transaction as existing files.
- Modify `tests/test_publish.py`: dynamic-directory preflight, replacement, stale-file deletion, rollback, and finalize-failure coverage.
- Modify `update_data.py`: select effective validated league/club payloads, stage calendar artifacts, and publish them transactionally.
- Modify `tests/test_update_data.py`: generation ordering, dry-run, failure, no-op, and rollback coverage.
- Modify `.github/workflows/update.yml` and `tests/test_workflow_contract.py`: stage only the approved calendar artifacts in the six-hour data commit.
- Generate `calendar_index.json`, `calendar_index.js`, `calendar_state.json`, and `calendars/*.ics`: initial public subscription data derived from the current committed league and club data.
- Modify `app_utils.js` and `tests/test_user_value_utils.js`: pure index resolution and GitHub-Pages-safe HTTPS/`webcal` URL construction.
- Create `tests/test_calendar_subscription.js` and `tests/test_calendar_subscription.py`: executable browser-UI contracts for subscription cards/dialog and removal of one-off downloads.
- Modify `bundle_v31.js`: global favorites rendering, calendar card/dialog integration, and removal of the per-game calendar Blob path.
- Modify `style.css`: focused accessible styles matching the existing dark sports UI.
- Modify `index.html`, `sw_v31.js`, `tests/test_service_worker_status.js`, and `tests/test_github_pages_runtime.py`: load and refresh the calendar index under `/BWEDL-Stats/` without precaching every feed.
- Modify `USER_GUIDE.md`, `WIKI.md`, and `README.md`: explain the team-only league subscription, provider refresh delay, missing-address behavior, and shared favorites list.

---

### Task 1: Parse regular league fixtures and resolve stable team identities

**Files:**
- Create: `pipeline/calendar_feeds.py`
- Create: `tests/test_calendar_feeds.py`

- [ ] **Step 1: Write failing parser and identity tests**

Create `tests/test_calendar_feeds.py` with focused fixtures and these initial tests:

```python
from copy import deepcopy
from datetime import UTC, datetime

import pytest

from pipeline.calendar_feeds import (
    CalendarSourceError,
    build_club_catalog,
    parse_regular_league_games,
)


CLUBS = {
    "clubs": [
        {
            "number": "010",
            "name": "DC Heim e.V.",
            "venue": "Dartheim",
            "street": "Hauptstraße 1",
            "city": "75100 Teststadt",
        },
        {
            "number": "020",
            "name": "DC Gast",
            "venue": "Gasthaus Ziel",
            "street": "Nebenweg 2",
            "city": "75200 Gaststadt",
        },
    ]
}


LEAGUES = {
    "leagues": {
        "A-Klasse Gruppe 1 2026-2027": {
            "match_days": {
                "1. Spieltag": (
                    "Fr. 28. 8.2026 20:00 DC Heim 2 - DC Gast ---\n"
                    "Fr. 28. 8.2026 20:00 Spielfrei - DC Heim ---"
                )
            }
        },
        "Ligapokal 2026-2027": {
            "match_days": {
                "Runde 1": "28.8.26 20:00 DC Heim 2 - DC Gast :"
            }
        },
    }
}


def test_regular_parser_excludes_cup_and_byes_and_resolves_team_slots():
    catalog = build_club_catalog(CLUBS)
    games = parse_regular_league_games(LEAGUES, catalog)

    assert len(games) == 1
    game = games[0]
    assert game.league == "A-Klasse Gruppe 1 2026-2027"
    assert game.round_name == "1. Spieltag"
    assert game.home.team_id == "club-010-team-2"
    assert game.away.team_id == "club-020-team-1"
    assert game.starts_at == datetime(2026, 8, 28, 18, 0, tzinfo=UTC)
    assert game.location == "Dartheim, Hauptstraße 1, 75100 Teststadt"
    assert game.address_incomplete is False


def test_date_without_official_time_is_not_published():
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 28. 8.2026 DC Heim - DC Gast ---"
                }
            }
        }
    }
    assert parse_regular_league_games(leagues, build_club_catalog(CLUBS)) == []


def test_unresolved_home_team_never_borrows_guest_address():
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": "Fr. 28. 8.2026 20:00 Unbekanntes Team - DC Gast ---"
                }
            }
        }
    }
    game = parse_regular_league_games(leagues, build_club_catalog(CLUBS))[0]
    assert game.home.team_id.startswith("team-")
    assert game.location == ""
    assert game.address_incomplete is True


def test_duplicate_team_fixture_in_same_league_round_is_rejected():
    leagues = {
        "leagues": {
            "A-Klasse 2026-2027": {
                "match_days": {
                    "1. Spieltag": (
                        "Fr. 28. 8.2026 19:00 DC Heim - DC Gast ---\n"
                        "Sa. 29. 8.2026 19:00 DC Heim - DC Gast 2 ---"
                    )
                }
            }
        }
    }
    with pytest.raises(CalendarSourceError, match="more than one fixture"):
        parse_regular_league_games(leagues, build_club_catalog(CLUBS))
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py -q
```

Expected: collection fails with `ModuleNotFoundError: No module named 'pipeline.calendar_feeds'`.

- [ ] **Step 3: Implement the minimal parser and identity API**

Create `pipeline/calendar_feeds.py` with immutable records and the exact public entry points used above:

```python
from __future__ import annotations

import re
import hashlib
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo


BERLIN = ZoneInfo("Europe/Berlin")
BYE_NAMES = {"spielfrei", "freilos"}
KNOWN_CLUB_ALIASES = {
    "alla haeeeehr": ("Alla Häeeehr",),
    "heavy weigths brotzingen": ("Heavy Weights Brötzingen",),
    "dc lightning arrows": ("DC Ligthning Arrows",),
    "dc mephistos": ("DC Mephisto's",),
    "dc striker s": ("DC Strikers",),
    "dc underground fool s": ("DC Underground Fools",),
}
LINE_PATTERN = re.compile(
    r"^(?:[A-Za-zÄÖÜäöü]{2}\.\s*)?"
    r"(?P<day>\d{1,2})\.\s*(?P<month>\d{1,2})\.\s*(?P<year>\d{2,4})"
    r"(?:\s+(?P<hour>\d{1,2}):(?P<minute>\d{2}))?\s+"
    r"(?P<home>.+?)\s+-\s+(?P<away>.+?)\s*$"
)
SCORE_PATTERN = re.compile(r"\s+(?:---|\d+\s*:\s*\d+|:\s*)\s*$")


class CalendarSourceError(ValueError):
    pass


@dataclass(frozen=True)
class ClubTeam:
    team_id: str
    display_name: str
    club_number: str | None
    team_slot: int | None
    venue: str
    street: str
    city: str


@dataclass(frozen=True)
class LeagueGame:
    season: str
    league: str
    round_name: str
    home: ClubTeam
    away: ClubTeam
    starts_at: datetime
    location: str
    address_incomplete: bool


def normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = text.casefold().replace("ß", "ss")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _club_alias(value: Any) -> str:
    tokens = normalize_name(value).split()
    suffix = len(tokens) - 3 if tokens and tokens[-1].isdigit() else len(tokens) - 2
    if suffix >= 0 and tokens[suffix:suffix + 2] == ["e", "v"]:
        del tokens[suffix:suffix + 2]
    return " ".join(tokens)


def build_club_catalog(payload: dict[str, Any]) -> tuple[tuple[dict[str, Any], tuple[str, ...]], ...]:
    catalog = []
    for club in payload.get("clubs", []):
        canonical = _club_alias(club.get("name"))
        configured = club.get("aliases", ())
        if isinstance(configured, str):
            configured = (configured,)
        aliases = (club.get("name", ""), *configured, *KNOWN_CLUB_ALIASES.get(canonical, ()))
        catalog.append((club, tuple(filter(None, map(_club_alias, aliases)))))
    return tuple(catalog)


def _resolve_team(name: str, catalog: tuple[tuple[dict[str, Any], tuple[str, ...]], ...]) -> ClubTeam:
    normalized = _club_alias(name)
    matches = []
    for club, aliases in catalog:
        for alias in aliases:
            suffix = normalized[len(alias):].strip() if normalized.startswith(alias) else ""
            if normalized == alias or suffix.isdigit():
                matches.append((len(alias), club, int(suffix or "1")))
    longest = max((item[0] for item in matches), default=0)
    winners = {(str(item[1].get("number")), item[2]): item for item in matches if item[0] == longest}
    if len(winners) != 1:
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
        return ClubTeam(
            team_id=f"team-{digest}",
            display_name=name.strip(),
            club_number=None,
            team_slot=None,
            venue="",
            street="",
            city="",
        )
    _, club, slot = next(iter(winners.values()))
    club_number = str(club.get("number", "")).strip()
    if not club_number:
        raise CalendarSourceError(f"club number is missing: {name}")
    return ClubTeam(
        team_id=f"club-{club_number}-team-{slot}",
        display_name=name.strip(),
        club_number=club_number,
        team_slot=slot,
        venue=str(club.get("venue", "")).strip(),
        street=str(club.get("street", "")).strip(),
        city=str(club.get("city", "")).strip(),
    )


def _season_from_league(name: str) -> str:
    match = re.search(r"(20\d{2})[-/](20\d{2}|\d{2})", name)
    if not match:
        raise CalendarSourceError(f"league season is missing: {name}")
    end = match.group(2) if len(match.group(2)) == 4 else match.group(1)[:2] + match.group(2)
    return f"{match.group(1)}-{end}"


def parse_regular_league_games(payload: dict[str, Any], catalog) -> list[LeagueGame]:
    games = []
    occupied = set()
    for league_name, league in payload.get("leagues", {}).items():
        if "ligapokal" in normalize_name(league_name):
            continue
        season = _season_from_league(league_name)
        for round_name, round_text in (league.get("match_days") or {}).items():
            for raw_line in str(round_text).splitlines():
                line = SCORE_PATTERN.sub("", raw_line.strip())
                match = LINE_PATTERN.match(line)
                if not match or match.group("hour") is None:
                    continue
                home_name = match.group("home").strip()
                away_name = match.group("away").strip()
                if normalize_name(home_name) in BYE_NAMES or normalize_name(away_name) in BYE_NAMES:
                    continue
                year = int(match.group("year"))
                if year < 100:
                    year += 2000
                local_start = datetime(
                    year,
                    int(match.group("month")),
                    int(match.group("day")),
                    int(match.group("hour")),
                    int(match.group("minute")),
                    tzinfo=BERLIN,
                )
                home = _resolve_team(home_name, catalog)
                away = _resolve_team(away_name, catalog)
                for team in (home, away):
                    identity = (season, league_name, str(round_name), team.team_id)
                    if identity in occupied:
                        raise CalendarSourceError(f"more than one fixture for {team.display_name} in {league_name} {round_name}")
                    occupied.add(identity)
                address_fields = [home.venue, home.street, home.city]
                games.append(LeagueGame(
                    season=season,
                    league=league_name,
                    round_name=str(round_name),
                    home=home,
                    away=away,
                    starts_at=local_start.astimezone(UTC),
                    location=", ".join(filter(lambda item: item and item != "-", address_fields)),
                    address_incomplete=any(not item or item == "-" for item in address_fields),
                ))
    return games
```

- [ ] **Step 4: Run the parser tests and verify GREEN**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py -q
```

Expected: `4 passed`.

- [ ] **Step 5: Add a current-data identity audit**

Append this test, which must fail on unresolved or ambiguous teams rather than filtering them out:

```python
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_current_published_schedule_resolves_every_calendar_team():
    league_payload = json.loads((ROOT / "league_data.json").read_text(encoding="utf-8"))
    club_payload = json.loads((ROOT / "club_data.json").read_text(encoding="utf-8"))
    games = parse_regular_league_games(league_payload, build_club_catalog(club_payload))

    assert len(games) > 900
    assert all("Ligapokal" not in game.league for game in games)
    assert all(game.home.team_id.startswith("club-") for game in games)
    assert all(game.away.team_id.startswith("club-") for game in games)
    assert all(game.starts_at.tzinfo is UTC for game in games)
```

- [ ] **Step 6: Run the current-data audit and commit**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py -q
git add -- pipeline/calendar_feeds.py tests/test_calendar_feeds.py
git commit -m "feat: parse league fixtures for team calendars"
```

Expected: all calendar parser tests pass and the commit contains only the new module and its test.

---

### Task 2: Render deterministic stateful ICS feeds

**Files:**
- Modify: `pipeline/calendar_feeds.py`
- Modify: `tests/test_calendar_feeds.py`

- [ ] **Step 1: Write failing feed-state and RFC tests**

Add tests for the public API `build_calendar_publication(leagues, clubs, previous_state, generated_at)`:

```python
def test_feed_contains_team_perspective_address_and_subscription_headers():
    publication = build_calendar_publication(
        LEAGUES,
        CLUBS,
        previous_state=None,
        generated_at="2026-08-19T12:00:00Z",
    )
    feed = publication.feeds["club-010-team-2.ics"]
    assert "X-WR-CALNAME:BWEDL - DC Heim 2\r\n" in feed
    assert "REFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n" in feed
    assert "SUMMARY:Heimspiel gegen DC Gast\r\n" in feed
    assert "DTSTART:20260828T180000Z\r\n" in feed
    assert "DTEND:20260828T210000Z\r\n" in feed
    assert "LOCATION:Dartheim\\, Hauptstraße 1\\, 75100 Teststadt\r\n" in feed
    assert "Heim/Auswärts: Heimspiel" in feed.replace("\\n", "\n")


def test_reschedule_keeps_uid_and_increments_sequence():
    first = build_calendar_publication(LEAGUES, CLUBS, None, "2026-08-19T12:00:00Z")
    changed = deepcopy(LEAGUES)
    changed["leagues"]["A-Klasse Gruppe 1 2026-2027"]["match_days"]["1. Spieltag"] = (
        "Sa. 29. 8.2026 19:30 DC Gast - DC Heim 2 ---"
    )
    second = build_calendar_publication(changed, CLUBS, first.state, "2026-08-20T12:00:00Z")
    first_event = next(iter(first.state["events"].values()))
    second_event = next(iter(second.state["events"].values()))
    assert second_event["uid"] == first_event["uid"]
    assert second_event["sequence"] == first_event["sequence"] + 1
    assert second_event["status"] == "CONFIRMED"
    assert second_event["is_home"] is False


def test_removed_fixture_is_cancelled_and_can_be_confirmed_again():
    first = build_calendar_publication(LEAGUES, CLUBS, None, "2026-08-19T12:00:00Z")
    empty = {"leagues": {"A-Klasse Gruppe 1 2026-2027": {"match_days": {}}}}
    cancelled = build_calendar_publication(empty, CLUBS, first.state, "2026-08-20T12:00:00Z")
    cancelled_event = next(iter(cancelled.state["events"].values()))
    assert cancelled_event["status"] == "CANCELLED"
    restored = build_calendar_publication(LEAGUES, CLUBS, cancelled.state, "2026-08-21T12:00:00Z")
    restored_event = next(iter(restored.state["events"].values()))
    assert restored_event["uid"] == cancelled_event["uid"]
    assert restored_event["status"] == "CONFIRMED"
    assert restored_event["sequence"] == cancelled_event["sequence"] + 1
```

Also add explicit tests for an incomplete address warning, CR/LF injection escaping, comma/semicolon escaping, 75-octet UTF-8 folding, a normalized-name collision, unchanged state producing byte-identical feeds, and old-season state being dropped at season rollover.

- [ ] **Step 2: Run the feed tests and verify RED**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py -q
```

Expected: failures report that `build_calendar_publication` and its result type are not defined.

- [ ] **Step 3: Implement publication records, event state, and ICS rendering**

Add these public records and helpers to `pipeline/calendar_feeds.py`, keeping all serialized keys exactly as shown:

```python
import json
from dataclasses import asdict
from datetime import timedelta


@dataclass(frozen=True)
class CalendarPublication:
    index: dict[str, Any]
    state: dict[str, Any]
    feeds: dict[str, str]


def _utc_text(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _escape_ics(value: Any) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
        .replace(";", "\\;")
        .replace(",", "\\,")
    )


def _fold_line(line: str) -> str:
    physical = []
    current = ""
    current_bytes = 0
    for character in line:
        width = len(character.encode("utf-8"))
        if current and current_bytes + width > 75:
            physical.append(current)
            current = " " + character
            current_bytes = 1 + width
        else:
            current += character
            current_bytes += width
    physical.append(current)
    return "\r\n".join(physical)


def _stable_uid(game: LeagueGame, team: ClubTeam) -> str:
    source = "|".join((game.season, game.league, game.round_name, team.team_id))
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()[:24]
    return f"{digest}@bwedl-stats"


def _event_payload(game: LeagueGame, team: ClubTeam, opponent: ClubTeam, is_home: bool) -> dict[str, Any]:
    description = [
        f"Begegnung: {game.home.display_name} - {game.away.display_name}",
        f"Heim/Auswärts: {'Heimspiel' if is_home else 'Auswärtsspiel'}",
        f"Liga: {game.league}",
        f"Spieltag: {game.round_name}",
    ]
    if game.home.club_number is None:
        description.append("Austragungsort nicht auflösbar")
    elif game.address_incomplete:
        description.append("Adresse unvollständig")
    return {
        "uid": _stable_uid(game, team),
        "feed_id": team.team_id,
        "season": game.season,
        "league": game.league,
        "round_name": game.round_name,
        "team_name": team.display_name,
        "opponent": opponent.display_name,
        "home_name": game.home.display_name,
        "away_name": game.away.display_name,
        "is_home": is_home,
        "starts_at": game.starts_at.isoformat().replace("+00:00", "Z"),
        "ends_at": (game.starts_at + timedelta(hours=3)).isoformat().replace("+00:00", "Z"),
        "location": game.location,
        "address_incomplete": game.address_incomplete,
        "description": "\n".join(description),
        "status": "CONFIRMED",
    }


def _semantic_fingerprint(event: dict[str, Any]) -> str:
    fields = {key: event[key] for key in (
        "opponent", "home_name", "away_name", "is_home", "starts_at",
        "ends_at", "location", "address_incomplete", "description", "status",
    )}
    encoded = json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
```

Implement `build_calendar_publication` so it:

1. creates one event perspective for home and one for away;
2. keys identity by stable UID;
3. retains sequence/last-modified when the semantic fingerprint is unchanged;
4. increments sequence for changed, cancelled, and restored events;
5. keeps missing current-season events as `CANCELLED` using their last published DTSTART/DTEND;
6. drops events outside the newly effective season set;
7. builds `index = {"version": 1, "generated_at": generated_at, "teams": {normalized_name: {"name": display_name, "path": "calendars/<team-id>.ics"}}}` and rejects collisions;
8. renders feeds in sorted team/event order with `METHOD:PUBLISH`, `X-WR-CALNAME`, six-hour refresh hints, `UID`, `SEQUENCE`, `DTSTAMP`, `LAST-MODIFIED`, `STATUS`, time, summary, description, and optional location;
9. returns CRLF-terminated feeds whose physical lines are folded by `_fold_line`.

- [ ] **Step 4: Add deterministic artifact writing and validation**

Add `write_calendar_publication(output_root, publication)` that writes:

```text
calendar_index.json
calendar_index.js
calendar_state.json
calendars/<team-id>.ics
```

Use UTF-8 and LF for JSON/JavaScript, CRLF for ICS, `ensure_ascii=False`, sorted JSON keys, and the JavaScript prefix `const CALENDAR_FEED_INDEX = `. Reject any feed name outside `^[a-z0-9-]+\.ics$`, any missing `BEGIN:VCALENDAR`/`END:VCALENDAR`, duplicate UID in one feed, bare LF, and physical lines above 75 UTF-8 octets.

Add a CLI with explicit arguments:

```powershell
python -m pipeline.calendar_feeds --league-data league_data.json --club-data club_data.json --previous-state calendar_state.json --generated-at 2026-08-19T12:00:00Z --output-dir .calendar-build
```

The CLI must read only the three named inputs and write only below `--output-dir`.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py -q
git diff --check
git add -- pipeline/calendar_feeds.py tests/test_calendar_feeds.py
git commit -m "feat: generate stateful team calendar feeds"
```

Expected: all calendar tests pass, repeated generation with the same inputs is byte-identical, and the commit contains no generated root artifacts yet.

---

### Task 3: Publish an owned calendar directory transactionally

**Files:**
- Modify: `pipeline/publish.py`
- Modify: `tests/test_publish.py`

- [ ] **Step 1: Write failing owned-directory publication tests**

Add tests calling `publish_domains` with `additional_directories=("calendars",)` that prove:

```python
def test_owned_directory_promotes_new_files_and_removes_stale_files(tmp_path):
    published = tmp_path / "published"
    staging = tmp_path / "staging"
    (published / "calendars").mkdir()
    (published / "calendars" / "stale.ics").write_text("old", encoding="utf-8")
    (staging / "calendars").mkdir()
    (staging / "calendars" / "club-010-team-1.ics").write_text("new", encoding="utf-8")

    changed = publish_domains(
        staging,
        published,
        complete_results(),
        additional_directories=("calendars",),
    )

    assert (published / "calendars" / "club-010-team-1.ics").read_text(encoding="utf-8") == "new"
    assert not (published / "calendars" / "stale.ics").exists()
    assert published / "calendars" / "club-010-team-1.ics" in changed
```

Also cover source/destination symlinks, nested directories, non-regular files, invalid directory names, duplicate directory declarations, promotion failure after one changed feed, stale-file deletion failure, and `finalize` failure. Every failure test must assert exact restoration of prior bytes and prior file absence.

- [ ] **Step 2: Run the focused publication tests and verify RED**

Run:

```powershell
python -m pytest tests/test_publish.py -q
```

Expected: failures report that `publish_domains` does not accept `additional_directories`.

- [ ] **Step 3: Extend publication preflight and rollback**

Modify `publish_domains` with this signature:

```python
def publish_domains(
    staging: Path,
    published: Path,
    results: list[ValidationResult],
    *,
    additional_files: tuple[str, ...] = (),
    additional_directories: tuple[str, ...] = (),
    finalize: Callable[[list[Path]], None] | None = None,
) -> list[Path]:
```

Implement an owned-directory preflight that accepts only unique single basenames, rejects collisions with domain files/additional files, rejects symlink/non-directory roots, and accepts only direct regular child files with no subdirectories or symlinks. Build:

- promotion candidates for new/changed staged children;
- deletion candidates for published children absent from staging;
- byte snapshots for every destination that may change or disappear.

Promote changed files with the existing `promote_file`; delete only exact preflighted stale child paths; then run `finalize`. On any exception, restore every snapshot and remove only destinations that were absent before the transaction. Preserve the original exception as cause if rollback is incomplete.

- [ ] **Step 4: Run publication regression tests and commit**

Run:

```powershell
python -m pytest tests/test_publish.py tests/test_files.py -q
git diff --check
git add -- pipeline/publish.py tests/test_publish.py
git commit -m "feat: publish calendar trees atomically"
```

Expected: both suites pass and the existing domain/additional-file behavior is unchanged.

---

### Task 4: Integrate calendar artifacts into the validated data update

**Files:**
- Modify: `update_data.py`
- Modify: `tests/test_update_data.py`
- Modify: `.github/workflows/update.yml`
- Modify: `tests/test_workflow_contract.py`
- Create generated: `calendar_index.json`
- Create generated: `calendar_index.js`
- Create generated: `calendar_state.json`
- Create generated: `calendars/*.ics`

- [ ] **Step 1: Write failing update orchestration tests**

Add tests that monkeypatch `build_calendar_publication` and `write_calendar_publication` and assert:

- generation happens only after canonical domain results are all `publish`/`retain`;
- the effective payload is the candidate for `publish` and the current root payload for `retain`;
- generation happens in dry-run staging but no public calendar path changes;
- generation failure converts the run to failure and leaves all published bytes untouched;
- calendar index/state files and `calendars` participate in one `publish_domains` call;
- an unchanged calendar/data run creates no publication changes;
- report finalization failure restores prior calendar feeds.

Use a spy assertion matching this call contract:

```python
assert publish_call.kwargs["additional_files"] == (
    "data_status.json",
    "data_status.js",
    "calendar_index.json",
    "calendar_index.js",
    "calendar_state.json",
)
assert publish_call.kwargs["additional_directories"] == ("calendars",)
```

- [ ] **Step 2: Run update tests and verify RED**

Run:

```powershell
python -m pytest tests/test_update_data.py -q
```

Expected: new orchestration assertions fail because no calendar generation call exists.

- [ ] **Step 3: Integrate the generator without weakening domain validation**

Import `build_calendar_publication` and `write_calendar_publication`. Add `_effective_payload(domain, candidate_payloads, previous_payloads, indexed_results)` that returns the candidate only for `Decision.PUBLISH`, returns the prior payload only for `Decision.RETAIN`, and raises for any other decision.

When `ready` is true:

1. derive one deterministic `generated_at` from the new leagues-domain `updated_at` in the staged status, or from the prior leagues status on retain/no-op;
2. load prior `calendar_state.json` when present, otherwise use `None`;
3. build the publication from effective leagues/clubs;
4. write it below the current fresh staging directory;
5. invoke `publish_domains` with the five exact additional files and owned `calendars` directory when not dry-run;
6. turn any calendar exception into canonical failed results before public mutation and write a failed report.

Do not call a scraper, generator, or publisher from the browser bundle.

- [ ] **Step 4: Extend the workflow allowlist test first**

Change the expected token set in `tests/test_workflow_contract.py` to include exactly:

```python
{
    "league_data.json", "league_data.js", "ranking_data.json", "ranking_data.js",
    "club_data.json", "club_data.js", "archive_data.js", "archive_tables.js",
    "data_status.json", "data_status.js", "calendar_index.json", "calendar_index.js",
    "calendar_state.json", "calendars",
}
```

Run `python -m pytest tests/test_workflow_contract.py -q` and verify it fails because `.github/workflows/update.yml` still has the old explicit `git add --` line.

- [ ] **Step 5: Update the workflow explicit add line**

Change only the existing commit step to:

```yaml
git add -- league_data.json league_data.js ranking_data.json ranking_data.js club_data.json club_data.js archive_data.js archive_tables.js data_status.json data_status.js calendar_index.json calendar_index.js calendar_state.json calendars
```

Keep `permissions: contents: write`, the schedule, concurrency, tests, notification job, and failure artifact policy unchanged.

- [ ] **Step 6: Generate and validate the initial public feeds**

Use the committed current data and the leagues timestamp from `data_status.json`:

```powershell
$calendarGeneratedAt = (Get-Content -Raw -LiteralPath 'data_status.json' | ConvertFrom-Json).domains.leagues.updated_at
python -m pipeline.calendar_feeds --league-data league_data.json --club-data club_data.json --generated-at $calendarGeneratedAt --output-dir .
git add -- calendar_index.json calendar_index.js calendar_state.json calendars
python -m pipeline.calendar_feeds --league-data league_data.json --club-data club_data.json --previous-state calendar_state.json --generated-at $calendarGeneratedAt --output-dir .
git diff --exit-code -- calendar_index.json calendar_index.js calendar_state.json calendars
```

Do not use the wall clock. The final `git diff --exit-code` compares the second generation with the already staged first generation and therefore proves byte-for-byte idempotence.

- [ ] **Step 7: Run update/workflow/calendar tests and commit**

Run:

```powershell
python -m pytest tests/test_calendar_feeds.py tests/test_publish.py tests/test_update_data.py tests/test_workflow_contract.py -q
git diff --check
git add -- pipeline/calendar_feeds.py pipeline/publish.py update_data.py tests/test_calendar_feeds.py tests/test_publish.py tests/test_update_data.py tests/test_workflow_contract.py .github/workflows/update.yml calendar_index.json calendar_index.js calendar_state.json calendars
git commit -m "feat: publish team calendars with league data"
```

Expected: focused suites pass; generated artifacts are deterministic and contain no Ligapokal event.

---

### Task 5: Resolve calendar subscriptions in the static app shell

**Files:**
- Modify: `app_utils.js`
- Modify: `tests/test_user_value_utils.js`
- Modify: `index.html`
- Modify: `sw_v31.js`
- Modify: `tests/test_service_worker_status.js`
- Modify: `tests/test_github_pages_runtime.py`

- [ ] **Step 1: Write failing pure URL/index tests**

Add these imports and assertions to `tests/test_user_value_utils.js`:

```javascript
const {
    normalizeCalendarTeamName,
    resolveCalendarFeed,
    buildCalendarSubscriptionUrls,
} = require('../app_utils.js');

const calendarIndex = {
    version: 1,
    teams: {
        'dc heim 2': { name: 'DC Heim 2', path: 'calendars/club-010-team-2.ics' },
    },
};

assert.equal(normalizeCalendarTeamName('  DC Schömberg 2  '), 'dc schomberg 2');
assert.deepEqual(resolveCalendarFeed(calendarIndex, 'DC HEIM 2'), {
    name: 'DC Heim 2',
    path: 'calendars/club-010-team-2.ics',
});
assert.equal(resolveCalendarFeed(calendarIndex, 'DC Gast'), null);
assert.deepEqual(
    buildCalendarSubscriptionUrls(
        'calendars/club-010-team-2.ics',
        'https://tobias-rohde-93.github.io/BWEDL-Stats/#profile',
    ),
    {
        https: 'https://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
        webcal: 'webcal://tobias-rohde-93.github.io/BWEDL-Stats/calendars/club-010-team-2.ics',
    },
);
assert.equal(buildCalendarSubscriptionUrls('../escape.ics', 'https://example.test/BWEDL-Stats/'), null);
```

- [ ] **Step 2: Run the Node utility test and verify RED**

Run:

```powershell
node tests/test_user_value_utils.js
```

Expected: failure reports missing calendar helper exports.

- [ ] **Step 3: Implement strict index/path helpers**

Add to `app_utils.js`:

```javascript
function normalizeCalendarTeamName(value) {
    return typeof value === 'string'
        ? value
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('de-DE')
            .replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
}

function resolveCalendarFeed(index, teamName) {
    if (!index || index.version !== 1 || !index.teams || typeof index.teams !== 'object') return null;
    const entry = index.teams[normalizeCalendarTeamName(teamName)];
    if (!entry || typeof entry.name !== 'string' || typeof entry.path !== 'string') return null;
    if (!/^calendars\/[a-z0-9-]+\.ics$/.test(entry.path)) return null;
    return { name: entry.name, path: entry.path };
}

function buildCalendarSubscriptionUrls(path, baseUri) {
    if (typeof path !== 'string' || !/^calendars\/[a-z0-9-]+\.ics$/.test(path)) return null;
    try {
        const httpsUrl = new URL(path, baseUri);
        if (httpsUrl.protocol !== 'https:' && httpsUrl.hostname !== 'localhost' && httpsUrl.hostname !== '127.0.0.1') return null;
        return {
            https: httpsUrl.href,
            webcal: `webcal://${httpsUrl.host}${httpsUrl.pathname}`,
        };
    } catch (_error) {
        return null;
    }
}
```

Export all three functions in the existing browser/CommonJS API.

- [ ] **Step 4: Write failing shell/service-worker contracts**

Require `index.html` to load `calendar_index.js?v=1` after `data_status.js` and before `app_utils.js`. Require `sw_v31.js` to increment the cache name, precache `calendar_index.js?v=1`, classify `calendar_index.js/json` as network-first data, and not precache `calendars/*.ics` or `calendar_state.json`.

Run:

```powershell
node tests/test_service_worker_status.js
python -m pytest tests/test_github_pages_runtime.py -q
```

Expected: both contracts fail against the old asset list.

- [ ] **Step 5: Update shell and service worker and commit**

Add `<script src="calendar_index.js?v=1"></script>` to `index.html`, increment the cache to `bwedl-dashboard-v39`, add the index script to `urlsToCache`, and add `calendar_index.js/json` to `isDataFile`. Do not add feed files or state.

Run:

```powershell
node tests/test_user_value_utils.js
node tests/test_service_worker_status.js
python -m pytest tests/test_github_pages_runtime.py -q
git diff --check
git add -- app_utils.js tests/test_user_value_utils.js index.html sw_v31.js tests/test_service_worker_status.js tests/test_github_pages_runtime.py
git commit -m "feat: resolve published team calendar subscriptions"
```

Expected: all focused tests pass under the Pages subpath.

---

### Task 6: Add accessible Dashboard/Profile subscription UI and remove one-off downloads

**Files:**
- Create: `tests/test_calendar_subscription.js`
- Create: `tests/test_calendar_subscription.py`
- Modify: `bundle_v31.js`
- Modify: `style.css`
- Modify: `tests/test_personal_match_center.js`
- Modify: `tests/test_personal_match_center.py`

- [ ] **Step 1: Write failing subscription component contracts**

Create a Node DOM-harness test following `tests/test_season_context.js` and assert:

- `resolveMyCalendarSubscription()` returns a feed only for `myTeamName` present in `CALENDAR_FEED_INDEX`;
- `createCalendarSubscriptionCard('dashboard')` and `createCalendarSubscriptionCard('profile')` create `Kalender abonnieren` actions with no inline unsafe HTML;
- no-profile cards call `navigateTo('profile')` with label `Mein Profil einrichten`;
- `openCalendarSubscriptionDialog()` creates a native `<dialog>` with heading, team/season copy, HTTPS-copy button, `webcal` link, close button, Escape/close focus return, and status feedback;
- offline activation reports `Für das Kalender-Abo ist eine Internetverbindung erforderlich.` and does not open the dialog;
- failed clipboard writes report `Abo-Link konnte nicht kopiert werden.` without throwing.

Add a pytest wrapper that executes the Node file and checks its `team calendar subscription UI: ok` marker.

- [ ] **Step 2: Change the existing game-action expectation first**

In `tests/test_personal_match_center.js`, change the complete-game action keys from:

```javascript
['league', 'preview', 'calendar', 'share', 'maps']
```

to:

```javascript
['league', 'preview', 'share', 'maps']
```

Delete the Blob-download harness assertions and add source assertions that `downloadGameCalendar`, `calendarFilename`, `URL.createObjectURL`, and `link.download` are absent from `bundle_v31.js`.

- [ ] **Step 3: Run both focused tests and verify RED**

Run:

```powershell
node tests/test_calendar_subscription.js
node tests/test_personal_match_center.js
```

Expected: the subscription test fails because components are missing; the match-center test fails because the old calendar action still exists.

- [ ] **Step 4: Implement subscription resolution, card, and dialog**

In `bundle_v31.js`, add:

```javascript
function resolveMyCalendarSubscription() {
    const index = typeof CALENDAR_FEED_INDEX !== 'undefined'
        ? CALENDAR_FEED_INDEX
        : window.CALENDAR_FEED_INDEX;
    const feed = window.BwedlAppUtils.resolveCalendarFeed(index, myTeamName);
    if (!feed) return null;
    const urls = window.BwedlAppUtils.buildCalendarSubscriptionUrls(feed.path, document.baseURI);
    return urls ? { ...feed, ...urls } : null;
}
```

Implement `openCalendarSubscriptionDialog(trigger, subscription)` with DOM methods only. It must set `aria-labelledby`, use `showModal()`, add the `webcal` anchor, copy `subscription.https` with `navigator.clipboard.writeText`, update the existing `setAppStatus`, close from button/Escape/native cancel, remove itself after close, and restore focus to `trigger`.

Implement `createCalendarSubscriptionCard(context)` with CSS classes only. With no `myPlayerProfile` or `myTeamName`, render the profile-setup action. With an unresolved feed, render an explanatory status. With a resolved feed, render the team name, `Ligaspiele · aktuelle Saison`, and the subscription button. Before opening, require `navigator.onLine !== false`.

Insert the card:

- in `renderDashboard()` immediately before the next-game action area for a resolved profile;
- in `renderProfileSelection()` after the profile selection card.

- [ ] **Step 5: Remove the one-off ICS path**

Delete `calendarFilename`, `downloadGameCalendar`, and the `calendar` action branch from `buildGameActions`. Remove any now-unused `calendarGame` call path while preserving `gameAddress`, `gameCompetition`, sharing, route, preview, and the existing utility `buildIcsContent` only if another test/export still uses it. No game card may present an individual calendar download.

- [ ] **Step 6: Add focused accessible CSS**

Add `.calendar-subscription-card`, `.calendar-subscription-card__title`, `.calendar-subscription-card__meta`, `.calendar-subscription-card__action`, `.calendar-subscription-dialog`, `.calendar-subscription-dialog::backdrop`, `.calendar-subscription-dialog__actions`, and `.calendar-subscription-dialog__status`. Use existing slate backgrounds, blue primary action, gold calendar accent, visible `:focus-visible`, mobile stacked actions below `480px`, and `prefers-reduced-motion` compatibility. Do not change global fonts or the established color system.

- [ ] **Step 7: Run focused UI tests and commit**

Run:

```powershell
node tests/test_calendar_subscription.js
node tests/test_personal_match_center.js
python -m pytest tests/test_calendar_subscription.py tests/test_personal_match_center.py -q
node --check bundle_v31.js
git diff --check
git add -- bundle_v31.js style.css tests/test_calendar_subscription.js tests/test_calendar_subscription.py tests/test_personal_match_center.js tests/test_personal_match_center.py
git commit -m "feat: add team calendar subscription UI"
```

Expected: subscription and existing match actions pass without a per-game calendar action.

---

### Task 7: Show club favorites in both navigation contexts

**Files:**
- Modify: `bundle_v31.js`
- Modify: `tests/test_club_experience.js`
- Modify: `tests/test_club_experience.py`

- [ ] **Step 1: Write a failing global-favorites rendering test**

Compile `renderFavoritesSidebar` with a fake nav and these favorites:

```javascript
const favorites = [
    { type: 'league', id: 'A-Klasse 2026-2027', name: 'A-Klasse 2026-2027' },
    { type: 'club', id: 1, name: clubs[1].name },
];
```

Assert that the global `FAVORITEN` section contains both labels, that clicking the club calls `navigateTo('club', 1)`, and that a subsequent `renderClubSidebarShortcuts()` still shows the same club below its `Favoriten` heading.

- [ ] **Step 2: Run the club experience test and verify RED**

Run:

```powershell
node tests/test_club_experience.js
```

Expected: the global section contains only the league because `favorite.type !== 'club'` still filters clubs.

- [ ] **Step 3: Render every validated favorite globally**

Change `renderFavoritesSidebar` to iterate `favorites` rather than `nonClubFavorites`. Keep the existing empty-state behavior, icon-safe DOM construction, and `navigateTo(fav.type, fav.id)`. Do not remove the club-specific rendering in `renderClubSidebarShortcuts`.

Rename the local variable to `visibleFavorites` and filter only entries with a non-empty `name` and a route accepted by the existing normalization/startup contracts.

- [ ] **Step 4: Run favorites regressions and commit**

Run:

```powershell
node tests/test_club_experience.js
node tests/test_reported_ui_regressions.js
python -m pytest tests/test_club_experience.py tests/test_reported_ui_regressions.py -q
git diff --check
git add -- bundle_v31.js tests/test_club_experience.js tests/test_club_experience.py
git commit -m "fix: show club favorites in global navigation"
```

Expected: clubs appear in both intended menu locations and stale-favorite cleanup remains green.

---

### Task 8: Document, verify, and prepare GitHub Pages release evidence

**Files:**
- Modify: `README.md`
- Modify: `USER_GUIDE.md`
- Modify: `WIKI.md`
- Modify: `tests/test_github_pages_runtime.py`
- Modify: `tests/test_browser_security.py`

- [ ] **Step 1: Write failing documentation/runtime assertions**

Require the documentation to state all of the following exact user contracts:

- profile-team feed only;
- regular league games for the full current season;
- no Ligapokal and no single-game download;
- opponent, home/away, time, and best available home-club address;
- `webcal` open plus HTTPS copy;
- provider-controlled refresh delay;
- club favorites visible globally and under `VEREINE`.

Extend the Pages browser fixture with `calendar_index.js` and one test ICS file. Assert that Dashboard/Profile subscription URLs retain `/BWEDL-Stats/calendars/`, the dialog is keyboard-operable at `390 x 844`, and no `/api/` request occurs.

- [ ] **Step 2: Run documentation/browser contracts and verify RED**

Run:

```powershell
python -m pytest tests/test_github_pages_runtime.py -q
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q
```

Expected: documentation and browser assertions fail because the new behavior is not yet documented in those fixtures.

- [ ] **Step 3: Update the three user documents and browser fixture**

Update only the relevant favorites, calendar-action, data-update, and Pages sections. Replace claims that `Kalender` downloads one event with the approved subscription instructions. State that incomplete addresses are labeled and that calendar providers may refresh later than the six-hour publication cycle.

Update the browser fixture with inert calendar index values and a valid static ICS response. Keep its XSS probes and offline profile/match-setup checks intact.

- [ ] **Step 4: Run all deterministic local gates**

Run:

```powershell
node --check app_utils.js
node --check bundle_v31.js
node --check sw_v31.js
python -m pytest -q
$env:BWEDL_BROWSER_TESTS='1'; python -m pytest tests/test_browser_security.py -q
git diff --check
```

Expected baseline target: at least the pre-change `501 passed, 5 skipped`, plus the newly added tests, with the browser security suite passing when enabled. If sandbox temp creation produces `WinError 5`, repeat the identical pytest commands with the already approved elevated test permission and report the sandbox failure separately from code results.

- [ ] **Step 5: Perform a static artifact audit**

Run a script/test that parses every generated feed and asserts:

- every path in `calendar_index.json` exists;
- no extra `.ics` file exists outside the index;
- every feed has at least one current-season event or an intentional empty-feed marker;
- every event UID is unique within its feed;
- no feed text contains `Ligapokal`;
- every current published regular fixture with date/time appears in exactly two perspectives, one per participating team;
- rerunning the generator from committed inputs yields no diff.

- [ ] **Step 6: Commit documentation and verification contracts**

Run:

```powershell
git add -- README.md USER_GUIDE.md WIKI.md tests/test_github_pages_runtime.py tests/test_browser_security.py
git commit -m "docs: explain team calendar subscriptions"
git status --short
```

Expected: the isolated worktree is clean after the commit.

- [ ] **Step 7: Request final code review before integration**

Invoke `superpowers:requesting-code-review` against the full branch diff from `dd2160d` through `HEAD`. Address only verified findings using `superpowers:receiving-code-review`, with a failing regression test before every behavior fix.

- [ ] **Step 8: Verify GitHub and live Pages only after explicit push authorization**

After the user authorizes publishing, use the GitHub publishing workflow to push the exact isolated branch and open a draft PR or perform the explicitly requested integration route. Then verify separately:

```text
1. GitHub Actions test result
2. GitHub Pages deployment result
3. GET /BWEDL-Stats/calendar_index.json returns 200
4. One indexed /BWEDL-Stats/calendars/<team-id>.ics returns 200
5. Response content begins with BEGIN:VCALENDAR and contains no Ligapokal
6. Live Dashboard/Profile build the same HTTPS and webcal paths
```

Do not describe an external Apple/Google/Outlook refresh as verified until a real subscribed calendar has fetched a changed event. Report that provider refresh as manual/external evidence distinct from green CI and live file availability.

---

## Final acceptance checklist

- [ ] Club favorites render globally and under `VEREINE`.
- [ ] Only the stored profile team is offered as a subscription.
- [ ] Feeds contain the full current regular-league season and no Ligapokal.
- [ ] Every scheduled event includes opponent, perspective, time, and best available home address.
- [ ] Rescheduling updates UID/sequence without duplicates.
- [ ] Removed or de-scheduled published games become cancelled and can be restored.
- [ ] Dashboard and Profile expose HTTPS copy and `webcal` open.
- [ ] No per-game ICS download remains.
- [ ] Calendar/data publication is transactional and deterministic.
- [ ] Local suite, CI, Pages deployment, and external calendar refresh evidence are reported separately.
